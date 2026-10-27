import { assertRustRecordRequirement } from "../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";

import { rustValueCarrierBeforeContextualConversion } from "../../../dist/analysis/conversions/value-carrier-queries.js";
import { rustNativeCallableOperand } from "../../../dist/analysis/callables/native/native-conversions.js";
import { rustNativeCallablePhysicalSource } from "../../../dist/policy/conversions/native-callables.js";
import { rustCallableConversionPhysical } from "../../../dist/policy/conversions/callable-physical.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinReference } from "../../../dist/target-model/types/native-error-joins.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { nativeClosureProducerFixture } from "../../helpers/native-closure-producers.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";

test("native callable constructions use their sealed producer carrier rather than an unprepared storage query", () => {
  const current = nativeClosureProducerFixture();
  const { node, program } = current;
  const source = program.records.targetOperation.get(node).resultCarrier;
  const lambda = program.records.lambdaBody.get(node);
  assert.equal(lambda?.construction, "native", "the original producer is a native construction");
  assert.equal(lambda.protocol !== undefined, true, "the construction retains its checked runtime callable protocol");
  assert.equal(lambda.physicalCarrier !== undefined, true, "the actual producer owns its complete native carrier");
  const input = { records: program.records, storage: program.callableValues.nativeStorage,
    producers: program.callableValues.nativeProducers, frames: program.callableValues.frames };
  const physical = rustNativeCallableOperand(source, node, input);
  assert.equal(physical !== undefined, true, "the constructed value retains its physical source signature");
  assert.equal(rustTargetTypeRefEquals(physical.carrier, lambda.physicalCarrier), true,
    "the conversion consumes the exact sealed construction carrier");
  for (const [label, altered] of [
    ["missing physical construction", { ...lambda, physicalCarrier: undefined }],
    ["foreign logical construction", { ...lambda, constructionCarrier: { kind: "source-primitive", name: "float64" } }],
  ]) {
    const records = createRustRecordFixture({ lambdaBody: { get: subject => subject === node ? altered : program.records.lambdaBody.get(subject) } },
      program.records);
    assert.equal(rustNativeCallableOperand(source, node, { ...input, records }) === undefined, true, label);
  }
});

function fixture(text) {
  const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: [], files: { "index.ts": text } });
  return inspectFixture(program, requiredRecords);
}

function constructionFixture(text) {
  const program = analyzeRustErrorEffects(text, { surfaces: [] });
  return inspectFixture(program, program.requiredRecords);
}

function inspectFixture(program, requiredRecords) {
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
  const input = { records: program.records, storage: program.callableValues.nativeStorage,
    producers: program.callableValues.nativeProducers, frames: program.callableValues.frames };
  const declaration = name => {
    const node = declarations.get(name);
    assert.equal(node !== undefined, true, name);
    return node;
  };
  const initializer = name => Node_Initializer(ast, declaration(name));
  const operand = node => {
    const source = rustValueCarrierBeforeContextualConversion(program.records, node);
    assert.equal(source !== undefined, true, "checked source operand");
    const physical = rustNativeCallableOperand(source, node, input);
    assert.equal(physical !== undefined, true, "physical source operand");
    return physical;
  };
  const stored = name => {
    const node = declaration(name);
    const source = program.records.runtimeCarrier.get(node)?.carrier;
    assert.equal(source !== undefined, true, `${name}: the actual stored value has its checked source carrier`);
    const selected = input.storage.valueFor(node);
    assert.equal(selected.kind !== "unresolved", true, `${name}: ${selected.reason ?? "the original binding owns its published physical storage"}`);
    const physical = rustNativeCallablePhysicalSource(source, selected, input.frames);
    assert.equal(physical !== undefined, true, `${name}: the stored value supplies its exact physical callable signature`);
    return physical;
  };
  return { program, ast, input, declaration, initializer, operand, stored, requiredRecords };
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
  assertRustRecordRequirement(current.requiredRecords, "contextualValueConversion", node);
  const fact = current.program.records.contextualValueConversion.get(node);
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
    const value = current.stored(name);
    assert.equal(value.input === inputs[index], true, name);
    assert.equal(value.signature.error.kind, "associated-type");
    assert.equal(value.signature.error.name, "InvocationError");
    assert.equal(rustTargetTypeRefEquals(value.signature.error.owner, inputs[index].implementation), true);
    assert.equal(rustTargetTypeRefEquals(value.signature.error.trait, inputs[index].trait), true);
    const wrong = inputs[1 - index];
    assert.equal(rustNativeCallablePhysicalSource(inputs[index].carrier,
      { kind: "selected", carrier: inputs[index].implementation, inputs: [wrong] }, current.input.frames) === undefined,
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
    const physical = current.stored(name);
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
    assert.equal(input.environment.length, 1, "one actual outer type argument");
    const physical = current.stored(name);
    assert.equal(physical.input === input, true);
    assert.equal(input.environment[0].kind === "type" && rustTargetTypeRefEquals(physical.signature.result, input.environment[0].type), true);
    assert.equal(rustTargetTypeRefEquals(physical.signature.error.trait.genericArguments[0].type,
      input.environment[0].type), true, "associated error keeps the same selected environment");
  }
});

test("physical callable operand queries reject unrelated values, missing owners and ambiguous source alternatives", () => {
  const ambiguous = `
    export function choose(left: () => number, right: () => number): () => number {
      left = right; const selected = left; return selected;
    }
    export function original(): number { return 3; }
    export function create(): () => number { const callback = original; const other = 3; return callback; }
  `;
  const rejection = compileRust({ surfaces: [], files: { "index.ts": ambiguous } });
  const observedAst = createTargetSourceProgram(rejection.source).ast;
  assert.equal(rejection.result.artifacts.length, 0, "ambiguous formal implementations are rejected before emission");
  assert.deepEqual(rejection.result.diagnostics.map(({ code, message }) => ({ code, message })), [
    { code: "RUST_SOURCE_CALLABLE_SPECIALIZATION_NOT_CLOSED",
      message: "Native callable storage has distinct physical input alternatives requiring a sealed join." },
    { code: "RUST_SOURCE_CALLABLE_SPECIALIZATION_NOT_CLOSED",
      message: "Native callable storage has distinct physical input alternatives requiring a sealed join." },
  ], "both original ambiguous storage obligations remain precise source refusals");
  const originalFile = rejection.source.getSourceFile("/src/index.ts");
  const expectedNodes = [];
  const visit = node => {
    const name = observedAst.name(node);
    if (name !== undefined && observedAst.is.IsIdentifier(name) &&
      (observedAst.is.IsFunctionDeclaration(node) && observedAst.text(name) === "choose" ||
        observedAst.is.IsVariableDeclaration(node) && observedAst.text(name) === "selected")) expectedNodes.push(node);
    observedAst.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  assert.equal(originalFile !== undefined, true, "the original ambiguous source file is present");
  visit(originalFile);
  assert.equal(expectedNodes.length, 2, "the choose return and selected binding own the two source obligations");
  for (const [index, diagnostic] of rejection.result.diagnostics.entries()) {
    assert.equal(diagnostic.sourceNode === expectedNodes[index], true,
      `source refusal ${index} points to its exact original declaration, not another nonempty node`);
    assert.equal(observedAst.getSourceFile(diagnostic.sourceNode) === originalFile, true,
      `source refusal ${index} retains the original file and declaration span`);
  }
  const current = fixture(`
    export function original(): number { return 3; }
    export function create(): () => number { const callback = original; const other = 3; return callback; }
  `);
  const node = current.initializer("callback");
  const source = rustValueCarrierBeforeContextualConversion(current.program.records, node);
  assert.equal(current.operand(node).input === undefined, true, "direct source declaration owns its physical signature");
  assert.equal(rustNativeCallableOperand(source, current.initializer("other"), current.input) === undefined, true,
    "unrelated checked source node is not a callable operand");
  assert.equal(rustNativeCallableOperand(source, {}, current.input) === undefined, true,
    "unowned source node cannot supply an exact physical carrier");
  const selected = current.input.storage.valueFor(current.declaration("callback"));
  assert.equal(selected.kind, "selected");
  assert.equal(rustNativeCallablePhysicalSource(source,
    { kind: "identity", carrier: source }, current.input.frames) === undefined, true,
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
  const fact = current.program.records.contextualValueConversion.get(node);
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
    const destination = label === "returned"
      ? current.program.records.sourceCallableReturn.get(current.declaration("create"))?.returnCarrier : fact.targetCarrier;
    const retained = rustCallableConversionPhysical({ ...fact.conversion, target: destination }, source.signature,
      fileName, current.program.typeDefinitions);
    assert.equal(retained !== undefined, true, `${label}: exact native destination contract`);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, retained.carrier), true, label);
    assert.equal(selected.inputs.length, 0, "a concrete adapter is not a formal implementation");
  }
});

function adaptation(current, name) {
  const node = current.initializer(name);
  const fact = current.program.records.contextualValueConversion.get(node);
  assert.equal(fact?.conversion.kind, "callable-adapter", `${name}: finalized conversion`);
  const source = current.operand(node);
  const fileName = current.ast.getFileName(current.ast.getSourceFile(node));
  const expected = rustCallableConversionPhysical(fact.conversion, source.signature, fileName, current.program.typeDefinitions);
  assert.equal(expected !== undefined, true, `${name}: canonical physical contract`);
  for (const [label, selected] of [
    ["expression", current.input.storage.valueFor(node)],
    ["declaration", current.input.storage.valueFor(current.declaration(name))],
  ]) {
    assert.equal(selected.kind, "selected", `${name} ${label}: ${selected.reason ?? "exact physical storage"}`);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, expected.carrier), true, `${name} ${label}`);
  }
  return { source, expected };
}

function returnedAdaptation(current, owner, adaptation) {
  const destination = current.program.records.sourceCallableReturn.get(owner)?.returnCarrier;
  const protocol = rustCallableProtocol(destination);
  assert.equal(protocol?.lifetime !== undefined, true, "the actual retained return has a selected environment lifetime");
  const result = rustCallableConversionPhysical({ ...adaptation.expected.logical, target: destination },
    adaptation.source.signature, current.ast.getFileName(current.ast.getSourceFile(owner)), current.program.typeDefinitions);
  assert.equal(result !== undefined, true, "the same physical conversion owner closes the actual retained destination");
  assert.equal(rustTargetTypeRefEquals(result.error, adaptation.expected.error), true,
    "retention preserves the exact native input error identity");
  return result;
}

test("ordered source-produced adapters retain the preceding physical signature at every read", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function create(): (first: int32, second: int32) => int32 {
      const original = (): int32 => 3;
      const one: (first: int32) => int32 = original;
      const two: (first: int32, second: int32) => int32 = one;
      return two;
    }
  `);
  const one = adaptation(current, "one");
  const two = adaptation(current, "two");
  assert.equal(one.source.signature.parameters.length, 0);
  assert.equal(two.source.signature.parameters.length, 1);
  assert.equal(two.expected.parameters.length, 2);
  assert.equal(rustTargetTypeRefEquals(two.source.carrier, one.expected.carrier), true,
    "second operand is the first adapter, never the original zero-argument producer");
  const returned = current.input.storage.returnFor(current.declaration("create"));
  assert.equal(returned.kind, "selected", returned.reason);
  assert.equal(rustTargetTypeRefEquals(returned.carrier,
    returnedAdaptation(current, current.declaration("create"), two).carrier), true,
    "the returned adapter preserves its actual destination lifetime and complete physical signature");
});

test("source-produced adapter chains preserve earlier checked numeric conversion errors", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function create(): (value: number, unused: int32) => void {
      const original = (value: int32): int32 => value;
      const widened: (value: number) => number = original;
      const discarded: (value: number, unused: int32) => void = widened;
      return discarded;
    }
  `);
  const first = adaptation(current, "widened");
  const second = adaptation(current, "discarded");
  assert.equal(rustNativeErrorJoinReference(first.expected.error) !== undefined, true,
    "native numeric adaptation has its own checked failure channel");
  assert.equal(rustTargetTypeRefEquals(second.source.carrier, first.expected.carrier), true);
  assert.equal(rustTargetTypeRefEquals(second.expected.error, first.expected.error), true,
    "discarding the result cannot erase the preceding argument-conversion failure");
  assert.equal(second.expected.resultPlan.kind, "discard");
});

test("source-produced formal adapters retain their exact input dependency and associated native error", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function adapt<Value>(left: () => Value, right: () => Value): (first: int32, second: int32) => Value {
      const one: (first: int32) => Value = right;
      const two: (first: int32, second: int32) => Value = one;
      return two;
    }
  `);
  const owner = current.declaration("adapt");
  const inputs = current.program.callableValues.native.inputsFor(owner);
  const one = adaptation(current, "one");
  const two = adaptation(current, "two");
  assert.equal(one.source.input === inputs[1], true, "selected right input, not equal-signature left input");
  assert.equal(rustTargetTypeRefEquals(two.expected.error, one.source.signature.error), true);
  const returned = current.input.storage.returnFor(owner);
  assert.equal(returned.kind, "selected", returned.reason);
  assert.equal(rustTargetTypeRefEquals(returned.carrier, returnedAdaptation(current, owner, two).carrier), true,
    "the returned formal adapter preserves its actual destination lifetime and complete physical signature");
  assert.equal(returned.inputs.length, 1);
  assert.equal(returned.inputs[0] === inputs[1], true, "physical adapter preserves only its actual formal dependency");
});

test("returned adapters preserve exact invocation bindings through forwarded source calls", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export function adapt(callback: () => int32): (first: int32) => int32 {
      const widened: (first: int32) => int32 = callback;
      return widened;
    }
    export function forward(left: () => int32, right: () => int32): (first: int32) => int32 {
      const fromLeft = adapt(left);
      const fromRight = adapt(right);
      return fromRight;
    }
  `);
  const adapted = current.program.records.runtimeCarrier.get(current.declaration("widened"))?.carrier;
  const adaptedInput = current.initializer("widened");
  const conversion = current.program.records.contextualValueConversion.get(adaptedInput);
  assert.equal(conversion?.conversion.kind, "callable-adapter", "the required argument adapter is retained");
  assert.equal(rustTargetTypeRefEquals(adapted, conversion.targetCarrier), true,
    "binding storage publishes the selected exact destination, not its annotation's placeholder");
  const returns = [];
  const visit = node => {
    if (current.ast.is.IsReturnStatement(node)) returns.push(Node_Expression(current.ast, node));
    current.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(current.declaration("adapt"));
  assert.equal(returns.length, 1, "one original returned adapter value");
  assert.equal(current.program.records.contextualValueConversion.get(returns[0]) === undefined, true,
    "an already adapted return does not acquire a lifetime-only adapter");
  const inputs = current.program.callableValues.native.inputsFor(current.declaration("forward"));
  for (const [index, name] of ["fromLeft", "fromRight"].entries()) {
    const selected = current.input.storage.valueFor(current.declaration(name));
    assert.equal(selected.kind, "selected", `${name}: ${selected.reason ?? "exact activated result"}`);
    assert.equal(selected.inputs.length, 1);
    assert.equal(selected.inputs[0] === inputs[index], true, `${name}: exact caller input dependency`);
    const physical = rustCallablePhysicalSignature(selected.carrier);
    assert.equal(physical !== undefined, true, name);
    assert.equal(physical.parameters.length, 1);
    assert.equal(rustTargetTypeRefEquals(physical.error.owner, inputs[index].implementation), true,
      `${name}: error projection uses the activated caller input`);
  }
});

test("captured native inputs bind through their actual lexical invocation without rebinding the outer declaration", () => {
  const current = constructionFixture(`import type { int32 } from "@tsonic/core/types.js";
    export function outer(left: () => int32, right: () => int32): int32 {
      function inner(): int32 { return right(); }
      function unrelated(): int32 { return left(); }
      const result = inner();
      return result;
    }
  `);
  const owner = current.declaration("outer");
  const inner = current.declaration("inner");
  const inputs = current.program.callableValues.native.inputsFor(owner);
  const captured = current.program.callableValues.native.capturesFor(inner);
  assert.equal(inputs.length, 2, "both equal-signature outer inputs retain exact physical identities");
  assert.equal(captured.length, 1, "the actual inner body captures only right");
  assert.equal(captured[0] === inputs[1], true, "captured correspondence is the exact original right formal");
  const invocation = current.initializer("result");
  const selected = current.input.storage.invocationInputFor(inputs[1], invocation, owner);
  assert.equal(selected.kind, "selected", selected.reason ?? "the exact captured input is selected");
  assert.equal(selected.carrier === inputs[1].implementation, true, "the outer native input is retained, not a new inner binder");
  assert.equal(selected.inputs.length, 1, "one actual captured dependency");
  assert.equal(selected.inputs[0] === inputs[1], true, "the physical input identity is unchanged");
  const origins = current.input.storage.invocationOriginsFor(inputs[1], invocation, owner);
  assert.equal(origins.kind, "resolved", origins.reason ?? "checked capture transport");
  assert.equal(origins.subjects.length, 1, "one exact captured source origin");
  assert.equal(origins.subjects[0] === inputs[1].subject, true, "the capture and source transport share one subject");
  const wrong = current.input.storage.invocationInputFor(inputs[0], invocation, owner);
  assert.equal(wrong.kind, "unresolved", "an unrelated equal-signature outer input is not a capture");
  assert.equal(current.input.storage.invocationOriginsFor(inputs[0], invocation, owner).kind, "unresolved",
    "origin lookup applies the same exact callee/capture admission");
  assert.equal(current.input.storage.invocationInputFor(inputs[1], {}, owner).kind, "unresolved",
    "foreign invocation identity is never inspected or guessed");
});

test("returned native adapters retain the actual borrowed result environment without a static substitution", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    import type { Life, Ref } from "@tsonic/rust/types.js";
    export function adapt<Region extends Life>(callback: () => Ref<int32, Region>): (unused: int32) => Ref<int32, Region> {
      const adapted: (unused: int32) => Ref<int32, Region> = callback;
      return adapted;
    }
  `);
  const owner = current.declaration("adapt");
  const selected = adaptation(current, "adapted");
  const logical = current.program.records.sourceCallableReturn.get(owner)?.returnCarrier;
  const lifetime = rustCallableProtocol(logical)?.lifetime;
  assert.equal(lifetime !== undefined && lifetime.kind !== "placeholder" && lifetime.kind !== "static", true,
    "the actual retained native result keeps its authored borrowed environment");
  const returned = current.input.storage.returnFor(owner);
  assert.equal(returned.kind, "selected", returned.reason ?? "exact retained native adapter");
  const expected = returnedAdaptation(current, owner, selected);
  assert.equal(rustTargetTypeRefEquals(returned.carrier, expected.carrier), true,
    "native retention preserves the complete physical result, error and lifetime contract");
  const inputs = current.program.callableValues.native.inputsFor(owner);
  assert.equal(inputs.length, 1, "the exact borrowed callback input remains explicit");
  assert.equal(returned.inputs.length, 1, "one actual retained native dependency");
  assert.equal(returned.inputs[0] === inputs[0], true, "retention does not introduce a replacement input or adapter owner");
});
