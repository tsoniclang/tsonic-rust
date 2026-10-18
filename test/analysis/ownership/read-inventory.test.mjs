import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustReadOwnership, prepareRustReadOwnership } from "../../../dist/analysis/ownership/reads.js";
import { analyzeRustReadUses } from "../../../dist/analysis/ownership/uses.js";
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
  const records = builder.seal([]);
  const runtimeSelected = selected.filter(node => {
    const parent = source.ast.parent(node);
    return parent === undefined || source.ast.name(parent) !== node;
  });
  const input = {
    storage,
    nativeNodes: storage.nodes,
    records,
    operands: runtimeSelected.map(node => ({ node })),
    movingReads: new Set(),
    flow: { readTransfers: new Map(), captureRequirements: new Map(), captureTransfers: new Map(), graphs: new Map(), liveness: new Map() },
    captures: new Map(),
    nativeStorage: { operandFor(node) {
      assert.equal(nativeNodes.has(node), true, "only the original checked source can obtain native formation");
      return { kind: "resolved", carrier: records.runtimeCarrier.get(node).carrier };
    } },
    borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
    borrowEffectsInput: { ast: source.ast, records, navigation: source.navigation,
      readUses: analyzeRustReadUses(source.ast, storage.nodes, records), isNativeNode: node => nativeNodes.has(node) },
    definitions: emptyRustTypeDefinitions,
    genericRequirements: { contractFor: declaration => Object.freeze({ declaration,
      typeParameters: [], capturedTypeParameters: [], nativeInputs: [], associatedTypes: [],
      projectProjections: [], optionalStorage: [] }) },
    typeFamilies: { implementation: () => undefined },
    genericCallables: { definitionFor: () => undefined },
  };
  return { input, selected: runtimeSelected, semanticOnly: selected.filter(node => !runtimeSelected.includes(node)) };
}

function analyze(input) {
  const prepared = prepareRustReadOwnership(input);
  return prepared.kind === "rejected" ? prepared : analyzeRustReadOwnership({ ...input, requirements: prepared.requirements });
}

test("transparent storage reads are classified once from the complete checked inventory", async () => {
  const { input, selected } = await fixture();
  const selectedAnalysis = analyze(input);
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
    const result = analyze({ ...input, nativeNodes: nodes, storage: { ...input.storage, nodes } });
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID");
    assert.equal("ownership" in result, false);
  }
  const nodes = input.nativeNodes.filter(node => node !== operand);
  const nativeNodes = new Set(nodes);
  const result = analyze({ ...input, nativeNodes: nodes,
    borrowEffectsInput: { ...input.borrowEffectsInput, isNativeNode: node => nativeNodes.has(node) } });
  assert.equal(result.kind, "rejected", "a selected wrapper cannot manufacture an owned value from an excluded runtime operand");
  assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID", "the exact missing input remains an inventory error");
  assert.equal("ownership" in result, false, "a partial native inventory never publishes a read plan");
});

test("storage-read materialization respects finite node, work and row budgets before publication", async () => {
  const { input } = await fixture();
  for (const limits of [{ maximumNodes: 1 }, { maximumSteps: 1 }, { maximumTransportRows: 1 }]) {
    const result = analyze({ ...input, limits });
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED");
    assert.equal("ownership" in result, false);
  }
});

test("semantic declaration names never become runtime ownership reads", async () => {
  const { input, selected, semanticOnly } = await fixture();
  assert.equal(semanticOnly.length > 0, true, "the checked inventory contains the authored parameter definition");
  const result = analyze(input);
  assert.equal(result.kind, "resolved", "all actual runtime operands have complete native storage");
  for (const node of semanticOnly) {
    assert.equal(input.records.runtimeCarrier.get(node) !== undefined, true, "the semantic type remains available");
    assert.equal(result.ownership.reads.has(node), false, "a type fact alone never requests a runtime read");
  }
  for (const node of selected) assert.equal(result.ownership.reads.has(node), true, "every actual runtime operand remains classified");
});

test("a demanded physical operand cannot fall back to its logical carrier", async () => {
  const { input, selected } = await fixture();
  const missing = selected.at(-1);
  const result = analyze({ ...input, nativeStorage: { operandFor: node => node === missing
    ? { kind: "unresolved", reason: "actual operand was not prepared" } : input.nativeStorage.operandFor(node) } });
  assert.equal(result.kind, "rejected", "missing demanded native evidence rejects the complete owner result");
  assert.equal(result.diagnostics[0].code, "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", "the physical read owner reports the missing operand");
  assert.equal("ownership" in result, false, "no partial read records escape the failed admission");
});

test("a foreign physical operand cannot acquire ownership from unrelated source types", async () => {
  const { input } = await fixture();
  const result = analyze({ ...input, operands: [...input.operands, { node: {} }] });
  assert.equal(result.kind, "rejected", "only original admitted storage occurrences are runtime operands");
  assert.equal(result.diagnostics[0].code, "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", "the source occurrence correspondence is mandatory");
  assert.equal("ownership" in result, false, "a foreign operand never publishes a successful prefix");
});

test("prepared and completed reads share their original cumulative work budget", async () => {
  const { input } = await fixture();
  const measured = prepareRustReadOwnership(input);
  assert.equal(measured.kind, "resolved", "the complete original source preparation is available");
  const work = measured.requirements.budget.usage().steps;
  assert.equal(measured.requirements.budget.usage().nodes, input.nativeNodes.length,
    "the original checked nodes are charged once");
  const prepared = prepareRustReadOwnership({ ...input,
    limits: { maximumSteps: work + input.nativeNodes.length - 1 } });
  assert.equal(prepared.kind, "resolved", "the same finite budget admits preparation");
  const selected = analyzeRustReadOwnership({ ...input, requirements: prepared.requirements });
  assert.equal(selected.kind, "rejected", "completion cannot reset the same work budget");
  assert.equal(selected.diagnostics[0].code, "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", "the original finite owner rejects exhaustion");
  assert.equal("ownership" in selected, false, "no partial read records are published");
});
