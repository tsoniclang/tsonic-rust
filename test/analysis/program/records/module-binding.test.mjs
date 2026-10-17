import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../../dist/analysis/program/carrier-probe.js";
import { recordVariableStatementFacts } from "../../../../dist/analysis/control-flow/statements.js";
import { resolveRustModuleBindingValue } from "../../../../dist/analysis/program/module-declarations.js";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const wider = Object.freeze({ kind: "source-primitive", name: "int64" });

function patternRequest(builder, root, leaves, overrides = {}) {
  const selected = { declarationKind: "let", storage: "module-pattern", valueCarrier: integer,
    initializer: root, steps: leaves.map(declaration => ({ declaration, source: root, kind: "binding" })), ...overrides };
  return { context: { records: builder, requiredRecords: [] }, moduleBindings: { classifyValue: () => selected } };
}

function project(builder, declaration, carrier = integer) {
  builder.bindingProjections.resolve([], declaration, integer, carrier, { kind: "tuple-element", index: 0 });
}

test("module pattern publication waits for every leaf and preserves original identities", () => {
  const builder = createRustProgramRecordBuilder();
  const root = {};
  const first = {};
  const second = {};
  const walk = patternRequest(builder, root, [first, second]);
  project(builder, first);
  builder.moduleBindings.value(walk, root, "let", integer);
  assert.equal(builder.moduleBinding.get(root) === undefined, true, "unavailable root is not published");
  assert.equal(builder.moduleBinding.get(first) === undefined, true, "no partial leaf publication");
  project(builder, second);
  builder.moduleBindings.value(walk, root, "let", integer);
  const original = builder.moduleBinding.get(root);
  assert.equal(original?.storage, "module-pattern", "complete root uses the existing family's pattern form");
  assert.equal(original.steps[0].declaration === first && original.steps[1].declaration === second, true, "original leaf identities and order");
  for (const leaf of [first, second]) {
    assert.equal(builder.moduleBinding.get(leaf)?.storage, "module-cell", "ordinary live module storage");
    assert.equal(builder.moduleBinding.get(leaf)?.initialization, "value", "leaf is initialized by projection");
  }
  builder.moduleBindings.value(walk, root, "let", { ...integer });
  assert.equal(builder.moduleBinding.get(root) === original, true, "identical request preserves canonical root identity");
  const foreign = {};
  const foreignWalk = patternRequest(builder, foreign, [foreign]);
  builder.moduleBindings.value(foreignWalk, foreign, "let", integer);
  assert.equal(builder.moduleBinding.get(foreign) === undefined, true, "structurally similar foreign leaves do not borrow projections");
  builder.seal(walk.context.requiredRecords);
  assert.throws(() => builder.moduleBindings.value(walk, root, "let", integer), /after analysis is sealed/u);
});

test("changed or inherited module pattern requests cannot publish partial transactions", () => {
  const parent = createRustProgramRecordBuilder();
  const root = {};
  const first = {};
  project(parent, first);
  const walk = patternRequest(parent, root, [first]);
  parent.moduleBindings.value(walk, root, "let", integer);
  const original = parent.moduleBinding.get(root);
  const sealed = parent.seal(walk.context.requiredRecords);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  const same = patternRequest(child, root, [first]);
  child.moduleBindings.value(same, root, "let", integer);
  assert.equal(child.moduleBinding.get(root) === original, true, "child reuses exact inherited evidence");
  for (const change of [
    { initializer: {} },
    { steps: [] },
    { steps: [{ declaration: first, source: {}, kind: "binding" }] },
    { steps: [{ declaration: first, source: root, kind: "pattern" }] },
  ]) {
    assert.throws(() => child.moduleBindings.value(patternRequest(child, root, [first], change), root, "let", integer),
      /Conflicting Rust semantic plan/u);
    assert.equal(child.moduleBinding.get(root) === original, true, "changed source transaction does not replace inherited root");
  }
  const second = {};
  project(child, second, wider);
  assert.throws(() => child.moduleBindings.value(patternRequest(child, root, [second]), root, "let", integer),
    /Conflicting Rust semantic plan/u);
  assert.equal(child.moduleBinding.get(second) === undefined, true, "a conflicting root cannot leak a fresh leaf");
  assert.equal(parent.moduleBinding.get(second) === undefined, true, "parent remains immutable");
});

test("array omissions retain checked identity without manufacturing a projected value", () => {
  const parent = createRustProgramRecordBuilder();
  const required = [];
  const subject = {};
  const source = { kind: "tuple", elements: [integer] };
  parent.bindingProjections.omitted(required, subject, source);
  const selected = parent.bindingProjection.get(subject);
  assert.equal(selected?.projection.kind, "omitted", "one existing projection family owns the omission");
  assert.equal(selected.sourceCarrier === source, true, "the original aggregate carrier is retained");
  for (const field of ["projectedCarrier", "storageCarrier", "bindingCarrier", "normalization"]) {
    assert.equal(field in selected, false, `${field}: no runtime value exists for a hole`);
  }
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.projection), true, "sealed immutable no-value evidence");
  const invalidRoot = {};
  parent.moduleBindings.value(patternRequest(parent, invalidRoot, [subject]), invalidRoot, "let", integer);
  assert.equal(parent.moduleBinding.get(invalidRoot) === undefined, true, "an omission cannot stand in for a runtime leaf projection");
  assert.equal(parent.moduleBinding.get(subject) === undefined, true, "no runtime module leaf is fabricated");
  assert.equal(required.some(entry => entry.family === "bindingProjection" && entry.subject === subject), true,
    "the exact original omitted element is a required record subject");
  assert.throws(() => parent.bindingProjections.omitted(required, subject, source), /Duplicate Rust semantic plan/u);
  const sealed = parent.seal(required);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  child.bindingProjections.omitted([], subject, { ...source, elements: [...source.elements] });
  assert.equal(child.bindingProjection.get(subject) === selected, true, "inherited omission identity remains canonical");
  for (const change of [
    builder => builder.bindingProjections.omitted([], subject, { kind: "tuple", elements: [wider] }),
    builder => builder.bindingProjections.resolve([], subject, source, integer, { kind: "tuple-element", index: 0 }),
  ]) {
    const conflicting = createRustProgramRecordBuilder(undefined, sealed);
    assert.throws(() => change(conflicting), /Conflicting Rust semantic plan/u);
    assert.equal(conflicting.bindingProjection.get(subject) === selected, true, "conflicting value/evidence cannot replace a hole");
  }
  assert.equal(child.bindingProjection.get({}) === undefined, true, "a lookalike subject does not inherit an omission");
  child.seal([]);
  assert.throws(() => child.bindingProjections.omitted([], {}, source), /after analysis is sealed/u);
});

for (const abrupt of [false, true]) {
  test(`one requested module root restores its caller after ${abrupt ? "an abrupt" : "a normal"} admission`, () => {
    const input = analyzeRustOperations("export const first: number = 1, second: number = 2;", { surfaces: [] });
    const { ast } = input.context;
    const declarations = input.context.sourceStorage.nodes.filter(node => ast.is.IsVariableDeclaration(node));
    assert.equal(declarations.length, 2, "the actual checked statement has two original roots");
    const root = declarations[1];
    const statement = ast.parent(ast.parent(root));
    const sourceFile = ast.getSourceFile(root);
    const current = createRustCarrierProbe(input.walk);
    const caller = {};
    const generator = {};
    const marker = new Error("root admission witness");
    let entered = 0;
    const walk = { ...current, currentCallableDeclaration: caller, currentGeneratorDeclaration: generator,
      context: { ...current.context, records: { ...current.context.records,
        typeOnlyDeclarations: { ...current.context.records.typeOnlyDeclarations, statement: () => undefined },
        compileTimeSource: { get(node) {
          assert.equal(node === root, true, "a requested root never replays its sibling");
          assert.equal(walk.resolving.has(root), true, "the canonical root producer owns the in-flight state");
          assert.equal(walk.currentCallableDeclaration === undefined && walk.currentGeneratorDeclaration === undefined,
            true, "module initialization is not analyzed in its caller's callable environment");
          entered++;
          if (abrupt) throw marker;
          return true;
        } },
      } } };
    const admit = () => recordVariableStatementFacts(walk, statement, sourceFile, root);
    if (abrupt) assert.throws(admit, error => error === marker, "the original abrupt failure is preserved");
    else admit();
    assert.equal(entered, 1, "the exact requested root enters once");
    assert.equal(walk.currentCallableDeclaration === caller && walk.currentGeneratorDeclaration === generator,
      true, "both original caller identities are restored");
    assert.equal(walk.resolving.has(root), false, "normal and abrupt exits both close the root's in-flight state");
  });
}

for (const state of ["in-flight", "rejected"]) {
  test(`a ${state} module root cannot replace its missing physical value with a logical annotation`, () => {
    const input = analyzeRustOperations("export const value: number = 1;", { surfaces: [] });
    const root = input.context.sourceStorage.nodes.find(node => input.context.ast.is.IsVariableDeclaration(node));
    assert.equal(root !== undefined, true, "the original annotated module declaration is checked");
    const current = createRustCarrierProbe(input.walk);
    const records = createRustProgramRecordBuilder(input.context.typeDefinitions);
    const walk = { ...current, context: { ...current.context, records } };
    if (state === "in-flight") walk.resolving.add(root);
    else walk.rejectedExpressions.add(root);
    assert.equal(resolveRustModuleBindingValue(walk, root) === undefined, true,
      "a declaration without a completed native value stays unresolved");
    assert.equal(records.runtimeCarrier.get(root) === undefined && records.moduleBinding.get(root) === undefined,
      true, "the logical annotation cannot fabricate final native runtime storage");
    assert.equal(walk.resolving.has(root), state === "in-flight", "a dependent query does not change its producer's root state");
    assert.equal(walk.rejectedExpressions.has(root), state === "rejected", "the original terminal rejection stays authoritative");
  });
}
