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
