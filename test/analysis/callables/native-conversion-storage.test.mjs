import assert from "node:assert/strict";
import test from "node:test";
import { Node_Initializer } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustContextualValueConversionFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustValueCarrierBeforeContextualConversion } from "../../../dist/analysis/facts/value-carrier-queries.js";
import { rustNativeCallableOperand, rustNativeCallablePhysicalSource } from "../../../dist/analysis/callables/native-conversions.js";
import { rustCallableConversionPhysical } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";

function fixture(text) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const { ast } = program.source;
  const declarations = new Map();
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) || ast.is.IsVariableDeclaration(node)) {
      const name = ast.name(node);
      if (name !== undefined) declarations.set(ast.text(name), node);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const input = { facts: program.facts, storage: program.callableValues.nativeStorage,
    producers: program.callableValues.nativeProducers, definitions: program.typeDefinitions };
  const declaration = name => {
    const node = declarations.get(name);
    assert.equal(node !== undefined, true, name);
    return node;
  };
  const initializer = name => Node_Initializer(ast, declaration(name));
  const operand = node => {
    const source = rustValueCarrierBeforeContextualConversion(program.facts, node);
    assert.equal(source !== undefined, true, "checked source operand");
    const physical = rustNativeCallableOperand(source, node, input);
    assert.equal(physical !== undefined, true, "physical source operand");
    return physical;
  };
  return { program, ast, input, declaration, initializer, operand };
}

test("source-produced conversion operands retain the original physical producer signature", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function create(): (unused: int32) => int32 {
      const original = (): int32 => 3;
      const adapted: (unused: int32) => int32 = original;
      return adapted;
    }
  `);
  const node = current.initializer("adapted");
  const fact = current.program.facts.getFact(node, rustContextualValueConversionFactKey);
  assert.equal(fact?.conversion.kind, "callable-adapter", "source checking selects adaptation");
  const physical = current.operand(node);
  assert.equal(physical.signature.parameters.length, 0, "operand is before its own contextual adapter");
  const error = rustProducerErrorReference(physical.signature.error);
  assert.equal(error !== undefined, true, "producer-owned exact error");
  const producer = current.input.producers.forIdentity(error.identity);
  assert.equal(producer?.declaration === current.initializer("original"), true);
  assert.equal(rustNativeCallableOperand(fact.targetCarrier, node, current.input) === undefined, true,
    "a destination signature cannot be passed off as the source operand");
});

test("source-produced physical formal signatures retain exact selected input and associated error", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function forward(left: () => int32, right: () => int32): () => int32 {
      const first = left; const second = right; return second;
    }
  `);
  const inputs = current.program.callableValues.native.inputsFor(current.declaration("forward"));
  assert.equal(inputs.length, 2);
  for (const [index, name] of ["first", "second"].entries()) {
    const value = current.operand(current.initializer(name));
    assert.equal(value.input === inputs[index], true, name);
    assert.equal(value.signature.error.kind, "associated-type");
    assert.equal(value.signature.error.name, "InvocationError");
    assert.equal(rustTargetTypeRefEquals(value.signature.error.owner, inputs[index].implementation), true);
    assert.equal(rustTargetTypeRefEquals(value.signature.error.trait, inputs[index].protocol.trait), true);
    const wrong = inputs[1 - index];
    assert.equal(rustNativeCallablePhysicalSource(inputs[index].carrier,
      { kind: "selected", carrier: inputs[index].implementation, inputs: [wrong] }, current.program.typeDefinitions) === undefined,
    true, "an equal logical signature cannot replace exact physical input identity");
  }
});

test("physical callable operands preserve checked member, tuple and array input projections", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    type Callback = () => int32;
    interface Holder<Value> { readonly callback: Value; }
    export function project(left: Holder<Callback>, right: Holder<Callback>,
      pair: [Callback, Callback], many: Callback[]): Callback {
      const first = left.callback;
      const second = right.callback;
      const tupleLeft = pair[0];
      const tupleRight = pair[1];
      const element = many[0];
      return second;
    }
  `);
  const owner = current.declaration("project");
  const parameters = current.ast.parameters(owner);
  const inputs = current.program.callableValues.native.inputsFor(owner);
  for (const [name, parameterIndex, projection, ordinal] of [
    ["first", 0, "member"], ["second", 1, "member"],
    ["tupleLeft", 2, "tuple-element", 0], ["tupleRight", 2, "tuple-element", 1],
    ["element", 3, "array-element"],
  ]) {
    const input = inputs.find(input => input.subject.node === parameters[parameterIndex] &&
      input.subject.projection[0]?.kind === projection &&
      (ordinal === undefined || input.subject.projection[0].index === ordinal));
    assert.equal(input !== undefined, true, `${name}: checked projected formal`);
    const physical = current.operand(current.initializer(name));
    assert.equal(physical.input === input, true, name);
    assert.equal(rustTargetTypeRefEquals(physical.signature.error.owner, input.implementation), true, name);
    assert.equal(physical.signature.error.trait.id, input.protocol.identity);
    assert.equal(Object.isFrozen(physical) && Object.isFrozen(physical.signature) &&
      Object.isFrozen(physical.signature.parameters), true, "immutable physical signature selection");
  }
});

test("physical callable signatures substitute declaration-generic environments without changing input identity", () => {
  const current = fixture(`
    export function retain<Value>(left: () => Value, right: () => Value): () => Value {
      const first = left; const second = right; return second;
    }
  `);
  const inputs = current.program.callableValues.native.inputsFor(current.declaration("retain"));
  for (const [index, name] of ["first", "second"].entries()) {
    const input = inputs[index];
    assert.equal(input.protocol.binding.environment.length, 1, "one actual outer type argument");
    const physical = current.operand(current.initializer(name));
    assert.equal(physical.input === input, true);
    assert.equal(rustTargetTypeRefEquals(physical.signature.result, input.protocol.binding.environment[0]), true);
    assert.equal(rustTargetTypeRefEquals(physical.signature.error.trait.genericArguments[0].type,
      input.protocol.binding.environment[0]), true, "associated error keeps the same selected environment");
  }
});

test("physical callable operand queries reject unrelated values, missing owners and ambiguous source alternatives", () => {
  const current = fixture(`
    export function choose(left: () => number, right: () => number): () => number {
      left = right; const selected = left; return selected;
    }
    export function original(): number { return 3; }
    export function create(): () => number { const callback = original; const other = 3; return callback; }
  `);
  const node = current.initializer("callback");
  const source = rustValueCarrierBeforeContextualConversion(current.program.facts, node);
  assert.equal(current.operand(node).input === undefined, true, "direct source declaration owns its physical signature");
  assert.equal(rustNativeCallableOperand(source, current.initializer("other"), current.input) === undefined, true,
    "unrelated checked source node is not a callable operand");
  assert.equal(rustNativeCallableOperand(source, {}, current.input) === undefined, true,
    "unowned source node cannot supply an exact physical carrier");
  assert.equal(rustNativeCallableOperand(source, current.initializer("selected"), current.input) === undefined, true,
    "distinct formal implementations require a sealed join, never a guessed selection");
  const selected = current.input.storage.valueFor(current.declaration("callback"));
  assert.equal(selected.kind, "selected");
  assert.equal(rustNativeCallablePhysicalSource(source,
    { kind: "identity", carrier: source }, current.program.typeDefinitions) === undefined, true,
    "logical callable storage cannot masquerade as exact native Result storage");
});

test("source-produced stored and returned adapters select the canonical physical conversion contract", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function create(): (unused: int32) => int32 {
      const original = (): int32 => 3;
      const adapted: (unused: int32) => int32 = original;
      return adapted;
    }
  `);
  const node = current.initializer("adapted");
  const fact = current.program.facts.getFact(node, rustContextualValueConversionFactKey);
  assert.equal(fact?.conversion.kind, "callable-adapter");
  const source = current.operand(node);
  const fileName = current.ast.getFileName(current.ast.getSourceFile(node));
  const expected = rustCallableConversionPhysical(fact.conversion, source.signature, fileName, current.program.typeDefinitions);
  assert.equal(expected !== undefined, true, "one physical conversion owner");
  for (const [label, selected] of [
    ["stored", current.input.storage.valueFor(current.declaration("adapted"))],
    ["returned", current.input.storage.returnFor(current.declaration("create"))],
  ]) {
    assert.equal(selected.kind, "selected", `${label}: ${selected.reason ?? "exact physical storage"}`);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, expected.carrier), true, label);
    assert.equal(selected.inputs.length, 0, "a concrete adapter is not a formal implementation");
  }
});
