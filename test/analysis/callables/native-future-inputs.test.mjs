import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";

import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { closedUnionCallbackCompletionSource } from "../../../../tsonic/test/fixtures/closed-union-callback-completion.mjs";
import * as futureInputs from "../../../dist/analysis/callables/native-future-inputs.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

test("early Future demand reads only stored type metadata without physical layout inputs", () => {
  assert.equal("selectRustNativeStorageTypeDemand" in futureInputs, false, "the superseded combined demand API is absent");
  const integer = rustSourcePrimitiveTargetType("int32");
  const future = rustFutureTargetType(integer);
  const callable = rustCallableTargetType([], future);
  for (const [label, carrier, expected] of [
    ["Future", future, true],
    ["stored Future", { kind: "array", element: future }, true],
    ["tuple Future", { kind: "tuple", elements: [integer, future] }, true],
    ["logical callback result", callable, false],
    ["native callback result", { kind: "closure", callTrait: "Fn", args: [], result: future }, false],
    ["function pointer result", { kind: "function-pointer", args: [], result: future }, false],
    ["stored callback signature", { kind: "array", element: callable }, false],
  ]) {
    const selected = futureInputs.selectRustNativeFutureTypeDemand(carrier, emptyRustTypeDefinitions, () => true, 0);
    assert.equal(selected.kind, "resolved", `${label}: source-free metadata resolves`);
    assert.equal(selected.future, expected, `${label}: only actual stored Future data is selected`);
    assert.equal("implementation" in selected, false, `${label}: physical implementation demand is not metadata`);
    assert.equal(Object.isFrozen(selected), true, `${label}: the metadata result is immutable`);
  }
  const limited = futureInputs.selectRustNativeFutureTypeDemand(future, emptyRustTypeDefinitions, () => false, 0);
  assert.equal(limited.kind, "unresolved", "source-free traversal preserves its finite budget");
});

function fixture(text) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  return storageFixture(program);
}

function constructionFixture(text) {
  return storageFixture(analyzeRustErrorEffects(text, { surfaces: [] }));
}

function storageFixture(program) {
  const ast = program.source.ast;
  const nodes = [];
  const walk = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) walk(child); }); };
  for (const file of program.sourceFiles) walk(file);
  const declaration = name => nodes.find(node => (ast.is.IsFunctionDeclaration(node) || ast.is.IsVariableDeclaration(node)) &&
    ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  const initializer = name => Node_Initializer(ast, declaration(name));
  return { program, ast, nodes, declaration, initializer, plan: program.callableValues.nativeStorage };
}

function requireSelected(value, label) {
  assert.equal(value.kind, "selected", value.reason ?? label);
  assert.equal(Object.isFrozen(value), true, label);
  return value.carrier;
}

function requireEnvironment(current, declaration) {
  const selected = current.plan.futureEnvironmentFor(declaration);
  assert.equal(selected.kind, "resolved", selected.reason ?? "exact Future environment");
  assert.equal(Object.isFrozen(selected), true);
  return selected;
}

function contains(carrier, expected, definitions) {
  if (carrier.kind === "reference") return contains(carrier.referent, expected, definitions);
  const optional = rustOptionElementCarrier(carrier);
  if (optional !== undefined) return contains(optional, expected, definitions);
  const leaves = rustUnionLeaves(carrier, definitions);
  return leaves?.some(leaf => rustTargetTypeRefEquals(leaf.carrier, expected)) ?? rustTargetTypeRefEquals(carrier, expected);
}

test("unobserved native Future inputs preserve one exact opaque implementation through aliases and return", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function retain(left: Promise<int32>, right: Promise<int32>): Promise<int32> {
      const first = left; const second = right; return first;
    }`);
  const owner = current.declaration("retain");
  const { inputs } = requireEnvironment(current, owner);
  assert.equal(inputs.length, 2);
  assert.equal(Object.isFrozen(inputs) && inputs.every(Object.isFrozen), true);
  assert.equal(inputs[0].implementation.identity === inputs[1].implementation.identity, false, "input identity is not signature identity");
  for (const [index, name] of ["first", "second"].entries()) {
    const carrier = requireSelected(current.plan.valueFor(current.declaration(name)), name);
    assert.equal(rustTargetTypeRefEquals(carrier, inputs[index].implementation), true, name);
    assert.equal(inputs[index].subject.node === current.ast.parameters(owner)[index], true, "exact original parameter");
  }
  const returned = requireSelected(current.plan.returnFor(owner), "returned first input");
  assert.equal(rustTargetTypeRefEquals(returned, inputs[0].implementation), true);
  assert.equal(JSON.stringify(inputs.map(input => input.implementation)).includes("Result"), false, "no invented Future output contract");
});

test("native Future input storage uses canonical optional union payloads without an opaque future reconstruction", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    type Outcome = Promise<int32> | string | undefined;
    export function read(value: Outcome): Outcome { const selected = value; return selected; }`);
  const owner = current.declaration("read");
  const parameter = current.ast.parameters(owner)[0];
  const [input] = requireEnvironment(current, owner).inputs;
  assert.equal(input !== undefined, true);
  const abi = current.program.records.sourceParameterAbi.get(parameter);
  for (const value of [current.plan.parameterFor(parameter), current.plan.returnFor(owner),
    current.plan.valueFor(current.declaration("selected"))]) {
    const carrier = requireSelected(value, "one canonical Future union payload");
    assert.equal(contains(carrier, input.implementation, current.program.typeDefinitions), true, "same F in optional union");
  }
});

test("the original callback completion reader retains its exact Future payload at the source storage owner", () => {
  const current = fixture(closedUnionCallbackCompletionSource);
  const owner = current.initializer("read");
  const [input] = requireEnvironment(current, owner).inputs;
  assert.equal(input !== undefined, true, "original read has one exact formal Future payload");
  const parameter = current.ast.parameters(owner)[0];
  const abi = current.program.records.sourceParameterAbi.get(parameter);
  const carrier = requireSelected(current.plan.parameterFor(parameter), "original read parameter");
  assert.equal(contains(carrier, input.implementation, current.program.typeDefinitions), true);
  const result = requireSelected(current.plan.returnFor(owner), "original read result");
  assert.equal(contains(result, input.implementation, current.program.typeDefinitions), true);
});

test("native Future input substitution preserves the caller implementation across generic forwarded source calls", () => {
  const current = constructionFixture(`import type { int32 } from "@tsonic/core/types.js";
    export function retain<Value>(value: Promise<Value>): Promise<Value> { return value; }
    export function forward(value: Promise<int32>): Promise<int32> { const selected = retain(value); return selected; }`);
  const owner = current.declaration("forward");
  const [input] = requireEnvironment(current, owner).inputs;
  const result = requireSelected(current.plan.prepareReturn(owner), "forwarded input");
  assert.equal(rustTargetTypeRefEquals(result, input.implementation), true);
  const invoked = requireSelected(current.plan.invocationReturnFor(current.declaration("retain"), current.initializer("selected")),
    "selected generic invocation");
  assert.equal(rustTargetTypeRefEquals(invoked, input.implementation), true);
});

test("native Future tuple and array projections retain separate exact formal leaves", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    import type { Ref, Life } from "@tsonic/rust/types.js";
    export function select<Region extends Life>(pair: [Ref<Promise<int32>, Region>, Ref<Promise<int32>, Region>],
      values: Ref<Promise<int32>, Region>[]): Ref<Promise<int32>, Region> {
      const first = pair[0]; const second = pair[1]; const element = values[0]; return first;
    }`);
  const owner = current.declaration("select");
  const { inputs } = requireEnvironment(current, owner);
  assert.equal(inputs.length, 3);
  for (const [index, name] of ["first", "second", "element"].entries()) {
    const binding = current.declaration(name);
    assert.equal(binding !== undefined && current.ast.is.IsElementAccessExpression(current.initializer(name)), true,
      `${name}: the actual checked projection initializes its published native storage binding`);
    const value = requireSelected(current.plan.valueFor(binding), name);
    assert.equal(contains(value, inputs[index].implementation, current.program.typeDefinitions), true, name);
    assert.equal(inputs[index].subject.projection[0].kind, index === 2 ? "array-element" : "tuple-element");
  }
});

test("captured native Future input storage retains its outer source identity without becoming callable", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    import type { Ref, Life } from "@tsonic/rust/types.js";
    export function retain<Region extends Life>(value: Ref<Promise<int32>, Region>): () => Ref<Promise<int32>, Region> {
      return () => value;
    }`);
  const owner = current.declaration("retain");
  const closure = current.nodes.find(node => current.ast.is.IsArrowFunction(node));
  const [input] = requireEnvironment(current, owner).inputs;
  const { captures } = requireEnvironment(current, closure);
  assert.equal(captures.length, 1);
  assert.equal(captures[0] === input, true, "exact outer input capture");
  assert.equal(current.program.callableValues.native.inputsFor(owner).length, 0, "Future is not a callable protocol");
  const result = requireSelected(current.plan.returnFor(closure), "captured return");
  assert.equal(result.kind, "reference");
  assert.equal(rustTargetTypeRefEquals(result.referent, input.implementation), true);
});

test("native Future physical storage rejects incompatible alternatives and foreign inputs", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function choose(left: Promise<int32>, right: Promise<int32>, flag: boolean): Promise<int32> {
      return flag ? left : right;
    }`);
  assert.equal(current.plan.returnFor(current.declaration("choose")).kind, "unresolved", "different opaque types require a native join");
  const foreign = fixture("export function foreign(): void {}");
  assert.equal(current.plan.futureEnvironmentFor(foreign.declaration("foreign")).kind, "unresolved");
  assert.equal(current.plan.parameterFor(foreign.declaration("foreign")).kind,
    "unresolved", "only owned exact formal parameters are accepted");
});
