import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustReadOwnership } from "../../../dist/analysis/ownership/reads.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

async function fixture() {
  const source = createTargetSourceProgram(await checkedSource("ownership-read-inventory", {
    "src/index.ts": `function read(value: string) { return ${"(".repeat(80)}value${")".repeat(80)}; }`,
  }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const nativeNodes = new Set(storage.nodes);
  const builder = createRustProgramRecordBuilder();
  const selected = storage.nodes.filter(node => source.ast.is.IsParenthesizedExpression(node) ||
    source.ast.is.IsIdentifier(node) && source.ast.text(node) === "value");
  for (const node of selected) {
    builder.runtimeCarriers.selected(node, { kind: "target-named", id: "rust.std.String" });
    if (source.ast.is.IsIdentifier(node)) {
      const parent = source.ast.parent(node);
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration ??
        (source.ast.is.IsParameterDeclaration(parent) ? parent : undefined);
      assert.equal(declaration !== undefined, true, "the fixture supplies each original checked storage binding");
      builder.sourceBindings.lexical(node, declaration, "value");
    }
  }
  const input = {
    storage,
    nativeNodes: storage.nodes,
    records: builder.seal([]),
    movingReads: new Set(),
    captures: new Map(),
    borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
    borrowEffectsInput: { ast: source.ast, isNativeNode: node => nativeNodes.has(node) },
    definitions: emptyRustTypeDefinitions,
    genericRequirements: { supportsClone: () => true },
    genericCallables: { definitionFor: () => undefined },
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
  const nodes = input.nativeNodes.filter(node => node !== operand);
  const nativeNodes = new Set(nodes);
  const result = analyzeRustReadOwnership({ ...input, nativeNodes: nodes,
    borrowEffectsInput: { ...input.borrowEffectsInput, isNativeNode: node => nativeNodes.has(node) } });
  assert.equal(result.kind, "rejected", "a selected wrapper cannot manufacture an owned value from an excluded runtime operand");
  assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID", "the exact missing input remains an inventory error");
  assert.equal("ownership" in result, false, "a partial native inventory never publishes a read plan");
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
