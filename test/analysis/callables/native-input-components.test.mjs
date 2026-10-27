import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { createRustNativeCallableInputPlan } from "../../../dist/analysis/callables/native-inputs.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture(source) {
  let context;
  compileRust({ surfaces: [], files: { "index.ts": source }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    assert.equal(context.diagnostics.length, 0, `the checked native input owner admits its source: ${JSON.stringify(
      context.diagnostics.map(({ code, message }) => ({ code, message })))}`);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  assert.equal(context !== undefined, true, "the fixture reaches the real initialized input producer");
  const declaration = name => context.nativeNodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === name);
  const input = { ast: context.ast, nativeNodes: context.nativeNodes, storage: context.sourceStorage,
    records: context.records, definitions: context.typeDefinitions, projectTypes: context.projectTypes,
    structuralShapes: context.structuralShapes, sourcePackages: context.sourcePackages, usedNames: new Set(),
    declaresGenericInputs: owner => context.ast.is.IsFunctionDeclaration(owner),
    ownedRetainedParameter: context.callableValues.native.isNativeRetainedParameter };
  return { context, declaration, input, native: context.callableValues.native };
}

test("structural native input components retain exact instantiated widths and original member identities", () => {
  const current = fixture(`
import type { int32, int64 } from "@tsonic/core/types.js";
type Contract<Value> = { readonly invoke: (value: Value) => Value };
export function narrow(value: Contract<int32>): void {}
export function wide(value: Contract<int64>): void {}
`);
  const rows = [];
  for (const [name, width] of [["narrow", "int32"], ["wide", "int64"]]) {
    const owner = current.declaration(name);
    assert.equal(owner !== undefined, true, `${name}: the original function exists`);
    const inputs = current.native.inputsFor(owner);
    assert.equal(inputs.length, 1, `${name}: the stored callable field owns one complete native input row`);
    const selected = inputs[0];
    const parameter = current.context.ast.parameters(owner)[0];
    assert.equal(selected.owner === owner && selected.subject.node === parameter && selected.subject.kind === "input", true,
      `${name}: the original formal and owner are retained`);
    assert.equal(selected.subject.projection.length, 1, `${name}: the data field has one exact original member projection`);
    const member = selected.subject.projection[0];
    assert.equal(member.kind === "member" && current.context.ast.is.IsPropertySignatureDeclaration(member.declaration), true,
      `${name}: the field projection uses the checked original property declaration`);
    const protocol = rustCallableProtocol(selected.carrier);
    assert.equal(protocol?.parameters.length === 1 && protocol.parameters[0].name === width && protocol.result.name === width, true,
      `${name}: original argument and result native widths are never substituted from a sibling application`);
    assert.equal(current.native.isConcreteCallableStorage(selected.subject), false,
      `${name}: generic classification is accompanied by its actual native protocol binding`);
    assert.equal(current.native.protocolForSourceItem(selected.protocol.ownerFileName, selected.protocol.targetName) === selected.protocol, true,
      `${name}: the published protocol is the identical canonical input owner`);
    assert.equal(current.native.isConcreteCallableStorage({ ...selected.subject }), undefined,
      `${name}: equal-shaped foreign subjects cannot read this classification`);
    rows.push(selected);
  }
  assert.equal(rows[0].subject.projection[0].declaration === rows[1].subject.projection[0].declaration, true,
    "both applications keep the same original generic member declaration");
  assert.equal(rows[0].implementation.identity === rows[1].implementation.identity, false,
    "separate formal owners retain separate native implementation identities");
  assert.equal(rustTargetTypeRefEquals(rows[0].carrier, rows[1].carrier), false,
    "the two completed callable contracts remain distinct");
});

test("structural native input components preserve optional tuple array and repeated sibling paths", () => {
  const current = fixture(`
type Leaf = { readonly invoke?: (value: number) => number };
type Input = { readonly left: Leaf; readonly right: Leaf; readonly values: readonly [Leaf, readonly Leaf[]]; readonly maybe?: Leaf };
export function take(value: Input): void {}
`);
  const inputs = current.native.inputsFor(current.declaration("take"));
  assert.equal(inputs.length, 5, "every actual stored sibling path owns its native callable input");
  const paths = inputs.map(selected => selected.subject.projection.map(component => component.kind === "member"
    ? current.context.ast.text(current.context.ast.name(component.declaration))
    : component.kind === "tuple-element" ? `tuple:${component.index}` : component.kind));
  for (const expected of [["left", "invoke"], ["right", "invoke"], ["values", "tuple:0", "invoke"],
    ["values", "tuple:1", "array-element", "invoke"], ["maybe", "invoke"]])
    assert.equal(paths.some(path => path.length === expected.length && path.every((value, index) => value === expected[index])), true,
      `the exact ordered source component path is present: ${expected.join("/")}`);
  for (const selected of inputs) {
    assert.equal(rustOptionElementCarrier(selected.carrier) !== undefined, true,
      "an optional callable retains its original native absence topology");
    assert.equal(current.native.isConcreteCallableStorage(selected.subject), false,
      "every repeated occurrence has its own completed classification");
    assert.equal(selected.protocol === current.native.protocolForSourceItem(selected.protocol.ownerFileName, selected.protocol.targetName), true,
      "every repeated occurrence refers to the canonical native protocol");
  }
});

test("plain structural parameters do not acquire callable layout or component requirements", () => {
  const current = fixture(`
type Plain = { readonly value: number; readonly nested: readonly [number, readonly string[]] };
export function plain(value: Plain): void {}
`);
  const native = createRustNativeCallableInputPlan({ ...current.input,
    structuralShapes: { definitionForCarrier() { assert.fail("plain data needs no callable layout admission"); },
      field() { assert.fail("plain data needs no callable field correspondence"); } } });
  assert.equal(native.issues.length, 0, "plain input admission is unchanged");
  assert.equal(native.inputsFor(current.declaration("plain")).length, 0, "plain data adds no native callable protocol");
});

test("native input component collection does not descend method or callable signature data", () => {
  const current = fixture(`
type Result = { readonly invoke: () => number };
type Input = { run(): Result };
export function method(value: Input): void {}
export function callback(value: () => Result): void {}
`);
  const owner = current.declaration("method");
  assert.equal(current.native.inputsFor(owner).length, 0, "a method belongs to its existing physical method owner");
  const callback = current.native.inputsFor(current.declaration("callback"));
  assert.equal(callback.length, 1, "a callable value contributes only its own original input protocol");
  assert.equal(callback[0].subject.projection.length, 0, "its result signature is not stored input data");
});

test("generic input classification cannot publish without its completed native protocol", () => {
  const current = fixture("export function invoke(callback: () => number): void {}");
  const native = createRustNativeCallableInputPlan({ ...current.input, sourcePackages: { ...current.input.sourcePackages, packages: [] } });
  const owner = current.declaration("invoke");
  const parameter = current.context.ast.parameters(owner)[0];
  const subject = current.context.sourceStorage.subject(parameter, "input");
  assert.equal(subject.kind, "resolved", "the original checked input subject remains exact");
  assert.equal(native.isConcreteCallableStorage(subject.subject), false, "the input genuinely needs a native protocol");
  assert.equal(native.inputsFor(owner).length, 0, "missing original component evidence cannot create a fabricated protocol");
  assert.equal(native.issues.some(issue => issue.subject === parameter && /completed input protocol binding/u.test(issue.message)), true,
    "the original owner reports the missing completed binding before publication");
});

test("native input component recursion is path-bounded and preserves genuine concrete inputs", () => {
  const current = fixture(`
type Input = { readonly invoke: () => number };
export function take(value: Input): void {}
`);
  const owner = current.declaration("take");
  const parameter = current.context.ast.parameters(owner)[0];
  const selected = current.context.records.sourceParameterAbi.get(parameter);
  const structural = rustStructuralObjectCarrierValue(selected.valueCarrier);
  assert.equal(structural?.fields.length, 1, "the original source has one admitted stored callable field");
  const concrete = createRustNativeCallableInputPlan({ ...current.input, declaresGenericInputs: () => false });
  const original = current.native.inputsFor(owner)[0].subject;
  assert.equal(concrete.isConcreteCallableStorage(original), true, "a legitimately concrete source keeps its native runtime callable");
  assert.equal(concrete.inputsFor(owner).length, 0, "concrete storage is not forced into a new generic input");
  assert.equal(concrete.issues.length, 0, "an exact concrete leaf completes without a protocol row");
  let carrier = selected.valueCarrier;
  for (let index = 0; index < 129; index++) carrier = { kind: "tuple", elements: [carrier] };
  const bounded = createRustNativeCallableInputPlan({ ...current.input, records: { ...current.input.records,
    sourceParameterAbi: { get: node => node === parameter ? { ...selected, valueCarrier: carrier } : current.input.records.sourceParameterAbi.get(node) } } });
  assert.equal(bounded.issues.some(issue => issue.subject === parameter && /bounded storage projection budget/u.test(issue.message)), true,
    "excessive component depth is an explicit original-owner failure, never a partial input proof");
  const cycle = { kind: "tuple", elements: [] };
  cycle.elements.push(cycle);
  const cyclicPlan = valueCarrier => createRustNativeCallableInputPlan({ ...current.input, records: { ...current.input.records,
    sourceParameterAbi: { get: node => node === parameter ? { ...selected, valueCarrier } : current.input.records.sourceParameterAbi.get(node) } } });
  assert.equal(cyclicPlan(cycle).issues.length, 0, "a cycle with no callable data adds no new input requirement");
  cycle.elements.push(selected.valueCarrier);
  assert.equal(cyclicPlan(cycle).issues.some(issue => issue.subject === parameter && /finite complete storage path/u.test(issue.message)), true,
    "a recursive callable component obligation cannot be certified by dropping its active path");
});
