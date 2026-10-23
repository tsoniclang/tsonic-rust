import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustReadOwnership } from "../../../dist/analysis/ownership/reads.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";

async function fixture() {
  const source = createTargetSourceProgram(await checkedSource("ownership-read-inventory", {
    "src/index.ts": `function read(value: string) { return ${"(".repeat(80)}value${")".repeat(80)}; }`,
  }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const nativeNodes = new Set(storage.nodes);
  const builder = createRustProgramRecordBuilder();
  const selected = storage.nodes.filter(node => source.ast.is.IsParenthesizedExpression(node) ||
    source.ast.is.IsIdentifier(node) && source.ast.text(node) === "value");
  for (const node of selected) builder.runtimeCarriers.selected(node, { kind: "target-named", id: "rust.std.String" });
  const input = {
    storage,
    nativeNodes: storage.nodes,
    records: builder.seal([]),
    flow: { movingReads: new Set(), captureTransfers: new Map() },
    borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
    borrowEffectsInput: { ast: source.ast, isNativeNode: node => nativeNodes.has(node) },
    definitions: emptyRustTypeDefinitions,
    genericRequirements: { supportsClone: () => true },
    genericCallables: { definitionFor: () => undefined },
    capturesFor: () => undefined,
    invocationTransfersCapture: () => false,
  };
  return { input, selected };
}

test("transparent storage reads are classified once from the complete checked inventory", async () => {
  const { input, selected } = await fixture();
  const selectedAnalysis = analyzeRustReadOwnership(input);
  assert.equal(selectedAnalysis.kind, "resolved");
  const wrappers = selected.filter(node => input.storage.source.ast.is.IsParenthesizedExpression(node));
  assert.equal(wrappers.length, 80);
  for (const node of selected) {
    const read = selectedAnalysis.ownership.reads.get(node);
    assert.equal(read?.readsStorage, true);
    assert.equal(read?.value.kind, "clone");
  }
});

test("an incomplete or unordered transparent inventory never silently selects a move", async () => {
  const { input, selected } = await fixture();
  const operand = selected.at(-1);
  for (const nodes of [input.storage.nodes.filter(node => node !== operand), [...input.storage.nodes].reverse()]) {
    const result = analyzeRustReadOwnership({ ...input, nativeNodes: nodes, storage: { ...input.storage, nodes } });
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID");
    assert.equal("ownership" in result, false);
  }
});

test("storage-read materialization respects finite node, work and row budgets before publication", async () => {
  const { input } = await fixture();
  for (const limits of [{ maximumNodes: 1 }, { maximumSteps: 1 }, { maximumTransportRows: 1 }]) {
    const result = analyzeRustReadOwnership({ ...input, limits });
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED");
    assert.equal("ownership" in result, false);
  }
});

for (const projection of [false, true]) {
  test(`an owned temporary transfers while a stored shared use retains its borrow (projection=${projection})`, async () => {
    for (const [sourceType, payload, ownedKind] of [
      ["string", rustStringTargetType(), "move"],
      ["number", rustSourcePrimitiveTargetType("float64"), "copy"],
    ]) {
      const source = createTargetSourceProgram(await checkedSource("ownership-owned-call-read", {
        "src/index.ts": `
          declare function get_text(): ${sourceType} | undefined;
          export function inspect(stored: ${sourceType} | undefined): void {
            void (get_text()!);
            void (stored!);
          }
        `,
      }));
      const storage = createSourceStorageQuery(source, source.sourceFiles);
      const { ast } = source;
      const temporary = storage.nodes.find(node => ast.is.IsCallExpression(node));
      const stored = storage.nodes.find(node => ast.is.IsIdentifier(node) && ast.text(node) === "stored" &&
        ast.is.IsNonNullExpression(ast.parent(node)));
      assert.equal(temporary !== undefined, true, "the checked fixture has its actual source invocation");
      assert.equal(stored !== undefined, true, "the checked fixture has its actual stored input read");
      const builder = createRustProgramRecordBuilder();
      const carrier = rustOptionTargetType(payload);
      for (const subject of [temporary, stored]) {
        builder.runtimeCarriers.selected(subject, carrier);
        if (projection) builder.flowReadProjections.project(subject, carrier, payload, { kind: "option-value" });
      }
      for (const node of storage.nodes) {
        if (ast.is.IsVoidExpression(node)) builder.targetOperations.source(node, {
          kind: "void-expression", operationId: "ownership-read.discard", resultCarrier: rustUnitTargetType(),
        });
      }
      const nativeNodes = new Set(storage.nodes);
      const selected = analyzeRustReadOwnership({
        storage, nativeNodes: storage.nodes, records: builder.seal([]),
        flow: { movingReads: new Set(), captureTransfers: new Map() },
        borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
        borrowEffectsInput: { ast, isNativeNode: node => nativeNodes.has(node) },
        definitions: emptyRustTypeDefinitions,
        genericRequirements: { supportsClone: () => true },
        genericCallables: { definitionFor: () => undefined },
        capturesFor: () => undefined, invocationTransfersCapture: () => false,
      });
      assert.equal(selected.kind, "resolved", "the complete checked inventory admits the reads");
      const owned = selected.ownership.reads.get(temporary);
      const shared = selected.ownership.reads.get(stored);
      assert.equal(owned?.readsStorage, false, "an invocation does not read a native source place");
      assert.equal(owned?.value.kind, ownedKind, "the temporary payload is consumed without a borrowed adapter or hidden clone");
      assert.equal(owned?.source.kind, ownedKind, "narrowing does not reborrow the owned temporary container");
      assert.equal(shared?.readsStorage, true, "the input is a genuine native storage read");
      assert.equal(shared?.value.kind, "borrow", "an existing shared use keeps the input's native borrow");
      assert.equal(shared?.source.kind, "borrow", "a stored narrowed payload retains its container borrow");
    }
  });
}
