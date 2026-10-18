import { createRustOwnershipFixture } from "../../../helpers/ownership.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustReadOwnership, prepareRustReadOwnership } from "../../../../dist/analysis/ownership/reads.js";
import { analyzeRustReadUses } from "../../../../dist/analysis/ownership/uses.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { selectRustFlowReadProjection } from "../../../../dist/policy/types/resolution/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../../dist/backend/planner/expressions/flow-reads.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustFutureTargetType, rustUnitTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

const projectTypes = { definitionForCarrier: () => undefined };

test("optional exclusive-reference projection is a native reborrow, never a Clone promise", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 8 });
  const sourceFile = fakeSourceFile({ text: "selected", statements: [node] });
  const selectedCarrier = { kind: "reference", mutable: true, referent: rustSourcePrimitiveTargetType("int32") };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, projectTypes);
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "option-reference");
  for (const canMove of [false, true]) {
    const context = { input: { program: {
      source: { ast: fakeAstReader([sourceFile]) },
      records: createRustRecordFixture({runtimeCarrier: { get: () => ({ carrier: sourceCarrier }) }}),
      ownership: createRustOwnershipFixture(node, sourceCarrier, canMove ? "move" : "clone"), projectTypes, configuration: { edition: "2024" },
    } }, sourceFile, diagnostics: [] };
    const expression = { kind: "path", path: "selected" };
    const projected = planRustFlowReadProjection(node, expression, selected.fact, context);
    assertNoTargetDiagnostics(context.diagnostics);
    assert.equal(projected.kind, "match");
    assert.deepEqual(projected.expression, canMove ? expression : {
      kind: "method-call", receiver: expression, method: "as_deref_mut", receiverMode: "mut-ref", args: [],
    });
    assert.equal(projected.arms[0].expression.kind, "path");
    for (const invalid of [{ ...selectedCarrier, mutable: false }, rustSourcePrimitiveTargetType("int32"),
      { ...selectedCarrier, referent: rustSourcePrimitiveTargetType("uint32") }]) {
      context.diagnostics.length = 0;
      assert.equal(planRustFlowReadProjection(node, expression, { ...selected.fact, selectedCarrier: invalid }, context), undefined);
      assert.equal(context.diagnostics.length, 1);
    }
  }
});

test("optional non-Clone payloads may move or borrow but cannot acquire a clone contract", async () => {
  const source = createTargetSourceProgram(await checkedSource("optional-future-copy-admission", {
    "src/index.ts": "function read(selected: number | null) { return selected; }",
  }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const declaration = storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node));
  const binding = source.ast.parameters(declaration)[0];
  const node = storage.nodes.find(node => source.ast.is.IsIdentifier(node) && source.ast.text(node) === "selected" &&
    source.ast.kindName(source.ast.parent(node)) === "KindReturnStatement");
  assert.equal(node !== undefined && binding !== undefined, true, "all three original cases retain exact checked read and binding identities");
  const sourceFile = source.ast.getSourceFile(node);
  const selectedCarrier = rustFutureTargetType(rustUnitTargetType());
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const builder = createRustProgramRecordBuilder();
  builder.runtimeCarriers.selected(node, sourceCarrier);
  builder.sourceBindings.lexical(node, binding, "selected");
  const selected = builder.flowReadProjections.resolve([], node, sourceCarrier, selectedCarrier, projectTypes, emptyRustTypeDefinitions);
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "option-value");
  const records = builder.seal([]);
  const contract = Object.freeze({ declaration, typeParameters: [], capturedTypeParameters: [], nativeInputs: [],
    associatedTypes: [], projectProjections: [], optionalStorage: [] });
  for (const [canMove, borrowed] of [[true, false], [false, true], [false, false]]) {
    const uses = new Map(analyzeRustReadUses(source.ast, storage.nodes, records));
    if (borrowed) uses.set(node, { mode: "shared", later: [], laterStart: 0, stableAcrossEffects: true });
    const input = { storage, nativeNodes: storage.nodes, records,
      operands: [{ node, origin: { kind: "operand" } }],
      movingReads: new Set(canMove ? [node] : []),
      flow: { readTransfers: new Map(), captureRequirements: new Map(), captureTransfers: new Map(), graphs: new Map(), liveness: new Map() },
      captures: new Map(),
      nativeStorage: { operandFor: subject => ({ kind: "resolved", carrier: records.runtimeCarrier.get(subject)?.carrier }) },
      borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
      borrowEffectsInput: { ast: source.ast, records, navigation: source.navigation, readUses: uses,
        isNativeNode: subject => storage.nodes.includes(subject) },
      definitions: emptyRustTypeDefinitions, typeFamilies: { implementation: () => undefined },
      genericRequirements: { contractFor: () => contract }, genericCallables: { definitionFor: () => undefined } };
    const prepared = prepareRustReadOwnership(input);
    assert.equal(prepared.kind, "resolved", "the complete original source inventory is admitted before ownership selection");
    const admitted = analyzeRustReadOwnership({ ...input, requirements: prepared.requirements });
    if (!canMove && !borrowed) {
      assert.equal(admitted.kind, "rejected", "the original non-Clone owned copy is rejected at admission");
      assert.equal(admitted.diagnostics.length, 1, "the original negative still produces exactly one diagnostic");
      assert.equal(admitted.diagnostics[0].code, "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", "the pre-seal read owner reports the missing Clone proof");
      assert.equal(admitted.diagnostics[0].sourceNode === node, true, "the same read is rejected before planning");
      assert.equal("ownership" in admitted, false, "failed ownership evidence is never published");
      continue;
    }
    assert.equal(admitted.kind, "resolved", "the original native move or borrow requires no Clone promise");
    const context = { input: { program: {
      source, records, ownership: admitted.ownership, projectTypes, typeDefinitions: emptyRustTypeDefinitions,
      configuration: { edition: "2024" },
    } }, sourceFile, diagnostics: [] };
    const projected = planRustFlowReadProjection(node, { kind: "path", path: "selected" },
      selected.fact, context, borrowed);
    assert.equal(projected.kind, "match");
    assert.equal(projected.arms[0].expression.kind, "path");
    assertNoTargetDiagnostics(context.diagnostics);
  }
});
