import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "../../helpers/native-closure-producers.mjs";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { rustCallableInvocationErrorEffects } from "../../../dist/analysis/errors/error-effects.js";
import { validateRustFinalizedOperationAbi } from "../../../dist/policy/operations/members/abi/validation.js";




import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { createRustSourceErrorEffectSelection } from "../../../dist/analysis/errors/source-error-effects.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustJsRejectionErrorIdentity } from "../../../dist/target-model/records/errors/error-effects.js";
import { rustJsErrorTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { Node_Expression, Node_Initializer, TryStatement_TryBlock, TryStatement_CatchClause,
  CatchClause_Block, TryStatement_FinallyBlock } from "@tsonic/target-api/source";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";

function fixture(text, options = {}) {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": text }, ...options });
  return analyzedFixture(program);
}

function analyzedFixture(program) {
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const declaration = name => {
    const selected = nodes.filter(node => (ast.is.IsFunctionDeclaration(node) || ast.is.IsVariableDeclaration(node)) &&
      ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
    assert.equal(selected.length, 1, name);
    return selected[0];
  };
  const effects = node => {
    const value = program.records.errorEffects.get(node);
    assert.equal(value !== undefined, true, "exact effects are total on the selected evaluation region");
    assert.equal(Object.isFrozen(value) && Object.isFrozen(value.nativeErrors), true);
    return value;
  };
  return { program, ast, nodes, declaration, effects,
    initializer: name => Node_Initializer(ast, declaration(name)),
    callable: name => effects(declaration(name)),
    calls: name => nodes.filter(node => {
      if (!ast.is.IsCallExpression(node)) return false;
      const callee = Node_Expression(ast, node);
      return callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === name;
    }) };
}

function assertChannels(actual, expected, localErrors = false) {
  assert.equal(actual.localErrors, localErrors, "local package channel remains separate");
  assert.equal(actual.nativeErrors.length, expected.length, "exact native channel count");
  for (const selected of expected) {
    const source = actual.nativeErrors.find(source => source.identity === selected.identity);
    assert.equal(source !== undefined, true, "exact native channel identity");
    assert.equal(rustTargetTypeRefEquals(source.errorType, selected.errorType), true, "exact native channel carrier");
  }
}

test("native provider invocation and its actual ABI conversion publish independent owner effects", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const nativeUint = { kind: "source-primitive", name: "native-uint" };
  const errorType = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure");
  const expectedNative = rustCallableInvocationErrorEffects(errorType).nativeErrors;
  assert.equal(expectedNative.length, 1, "the existing native fixture has one distinct error carrier");
  const source = `import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function call(value: int32): int32 { return fail(value); }`;
  for (const [label, fallible, converted] of [
    ["native and conversion", true, true], ["native only", true, false],
    ["conversion only", false, true], ["neither", false, false],
  ]) {
    const target = { form: "call", path: "fail", argModes: ["value"],
      ...(converted ? { argConversions: [{ kind: "exact-integer", source: int32, target: nativeUint }] } : {}) };
    const capability = createRustProviderPackage({
      id: "native-closure-producer-proof", version: "1.0.0", displayName: "Native closure producer proof", crates: [],
      modules: [{ moduleSpecifier: "test:producer", providerModuleId: "test.producer", exports: [{
        id: "test:producer::fail", name: "fail", kind: "function", signatures: [{
          id: "test:producer::fail()", name: "fail", parameters: [{ name: "value", type: int32 }], returnType: int32,
        }],
      }] }],
      operations: [{ exportId: "test:producer::fail", operationKind: "method", target,
        parameterCarriers: [int32], resultCarrier: int32,
        ...(fallible ? { isFallible: true, errorBoundary: "provider-native", errorCarrier: errorType } : {}),
      }],
    });
    const current = analyzedFixture(analyzeRustErrorEffects(source, { surfaces: [], packages: [capability] }));
    const calls = current.calls("fail");
    assert.equal(calls.length, 1, `${label}: one original checked provider call`);
    const node = calls[0];
    const operation = current.program.records.targetOperation.get(node);
    assert.equal(operation?.kind, "provider-operation", `${label}: the actual selector admitted the provider call`);
    const abi = operation.abi;
    assert.equal(validateRustFinalizedOperationAbi(abi), true, `${label}: the canonical finalized ABI is valid`);
    assert.equal(abi.effects.invocation, fallible ? "fallible" : "infallible", `${label}: native invocation phase`);
    assert.equal(abi.effects.errorBoundary, fallible ? "provider-native" : "none", `${label}: exact native boundary`);
    assert.equal(abi.targetArguments.length, 1, `${label}: one actual ABI argument`);
    const argument = abi.targetArguments[0];
    assert.equal(argument.source.kind, "argument", `${label}: actual source argument correspondence`);
    assert.equal(argument.source.sourceIndex, 0, `${label}: the original value argument`);
    assert.equal(argument.conversion.fallible, converted, `${label}: independent finalized conversion effect`);
    assert.equal(argument.conversion.kind, converted ? "semantic" : "identity", `${label}: actual finalized conversion shape`);
    assert.equal(rustTargetTypeRefEquals(argument.sourceCarrier, int32), true, `${label}: authored int32 is retained`);
    assert.equal(rustTargetTypeRefEquals(argument.parameterCarrier, converted ? nativeUint : int32), true,
      `${label}: actual native input carrier`);
    if (converted) {
      assert.equal(argument.conversion.conversion.kind, "exact-integer", `${label}: supported exact integer conversion`);
      assert.equal(rustTargetTypeRefEquals(argument.conversion.conversion.source, int32), true, `${label}: exact source evidence`);
      assert.equal(rustTargetTypeRefEquals(argument.conversion.conversion.target, nativeUint), true, `${label}: exact target evidence`);
    }
    if (fallible) assert.equal(rustTargetTypeRefEquals(abi.effects.errorCarrier, errorType), true,
      `${label}: the provider-native carrier is unchanged`);
    const expected = fallible ? expectedNative : [];
    assertChannels(current.effects(node), expected, converted);
    assertChannels(current.callable("call"), expected, converted);
  }
});

for (const surfaces of [[], ["js"]]) {
  test(`native environment writes retain their exact provider error through source callers (${surfaces[0] ?? "native"})`, async () => {
    const current = fixture(`import type { ProcessEnv } from "node:process";
function build(): ProcessEnv {
  const values: ProcessEnv = {};
  values["TSONIC_ENV_CHILD_ONLY"] = "child";
  values["TSONIC_ENV_CHILD_ONLY"] = undefined;
  return values;
}
export function copy(): ProcessEnv { return build(); }`, { surfaces, capabilities: [await nodejsCapability()] });
    const writes = current.nodes.filter(node => current.program.records.targetOperation.get(node)?.kind === "runtime-set");
    assert.equal(writes.length, 2, "both original provider writes are retained");
    let channel;
    for (const node of writes) {
      const operation = current.program.records.targetOperation.get(node);
      assert.equal(operation.abi.effects.invocation, "fallible", "the static ProcessEnv contract retains native failure");
      assert.equal(operation.abi.effects.errorBoundary, "provider-native", "the actual provider owns the native error");
      const actual = current.effects(node);
      assert.equal(actual.localErrors, false, "the provider invocation does not manufacture a package channel");
      assert.equal(actual.nativeErrors.length, 1, "one exact native invocation channel");
      const selected = actual.nativeErrors[0];
      assert.equal(rustTargetTypeRefEquals(selected.errorType, operation.abi.effects.errorCarrier), true,
        "effects retain the finalized provider ABI's error carrier");
      if (channel !== undefined) assert.equal(selected.identity, channel.identity, "both writes share their actual native error identity");
      channel = selected;
      const occurrence = current.program.physicalEmissionContexts.sourceOccurrences.find(occurrence => occurrence.node === node);
      assert.equal(occurrence !== undefined, true, "the actual write has a completed native emission occurrence");
      const form = current.program.records.providerForm.get(node, occurrence.operation.abi);
      assert.equal(form?.nativeResult !== undefined, true, "the original write publishes native Result syntax");
      assert.equal(form.nativeResult.local === undefined && form.nativeResult.operand.localOwner === undefined, true,
        "native provider errors stay distinct from package errors");
      assert.equal(form.nativeResult.operand.sources.length, 1, "one exact Result operand source");
      assert.equal(form.nativeResult.operand.sources[0].identity, selected.identity, "the operand retains the same source identity");
      assert.equal(form.nativeResult.channels.get(selected.identity)?.targetIdentity, selected.identity,
        "the completed enclosing region accepts that exact native channel");
    }
    assertChannels(current.callable("build"), [channel]);
    assertChannels(current.callable("copy"), [channel]);
    const selected = current.program.records.sourceErrorEffects.get(current.calls("build")[0]);
    assert.equal(selected?.edges.length, 1, "the real source call has one completed error correspondence");
    const edge = selected.edges[0];
    assert.equal(edge.declaration === current.declaration("build") && edge.kind === "invoke", true,
      "the actual build declaration owns the call edge");
    assert.equal(edge.nativeErrors.length, 1, "one exact native source-to-caller route");
    assert.equal(edge.nativeErrors[0].source.identity, channel.identity, "the declaration's native identity is retained");
    assert.equal(edge.nativeErrors[0].target.identity, channel.identity, "the caller's identical native error needs no rebranding");
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`native provider invocation preserves its selected error channel (${surfaces[0] ?? "native"})`, () => {
    const errorType = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure");
    const current = nativeClosureProducerFixture({ surfaces,
      packages: [nativeClosureProducerFailurePackage(errorType)],
      source: `import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 { return (): int32 => fail(); }`,
    });
    const selected = [];
    const visit = node => {
      const operation = current.program.records.targetOperation.get(node);
      if (operation?.kind === "provider-operation" && operation.abi.effects.errorBoundary === "provider-native")
        selected.push({ node, operation });
      current.program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    current.program.sourceFiles.forEach(visit);
    assert.equal(selected.length, 1, "the original checked native provider invocation is selected once");
    const { node, operation } = selected[0];
    assert.equal(operation.abi.effects.invocation, "fallible");
    assert.equal(operation.abi.effects.errorCarrier !== undefined, true, "selected native error evidence is required");
    const occurrence = current.program.physicalEmissionContexts.sourceOccurrences.find(occurrence => occurrence.node === node);
    assert.equal(occurrence !== undefined, true, "the original provider invocation has one finalized native ABI");
    const emission = current.program.records.providerForm.get(node, occurrence.operation.abi);
    assert.equal(emission?.nativeResult !== undefined, true, "the provider form publishes its exact native Result transport before rendering");
    const transport = emission.nativeResult;
    assert.equal(transport.local === undefined && transport.operand.localOwner === undefined, true,
      "a native provider error does not manufacture a package-local source channel");
    assert.equal(transport.operand.sources.length, 1, "one selected native provider error remains");
    const nativeSource = transport.operand.sources[0];
    assert.equal(rustTargetTypeRefEquals(nativeSource.errorType, operation.abi.effects.errorCarrier), true,
      "the provider Result keeps the exact selected native error carrier");
    assert.equal(transport.channels.get(nativeSource.identity)?.targetIdentity === nativeSource.identity, true,
      "the source and enclosing native region consume the identical selected channel");
    for (const subject of [node, current.node]) {
      const effects = current.program.records.errorEffects.get(subject);
      assert.equal(effects !== undefined, true, "the invocation and its producer both publish completed effects");
      assert.equal(effects.localErrors, false, "native provider failure never becomes a package-local error");
      assert.equal(effects.nativeErrors.length, 1, "one original native error channel remains");
      assert.equal(rustTargetTypeRefEquals(effects.nativeErrors[0].errorType, operation.abi.effects.errorCarrier), true,
        "the physical producer carries the exact selected provider error");
    }
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`captured generic producer errors bind concrete caller inputs (${surfaces[0] ?? "native"})`, () => {
    const current = analyzedFixture(analyzeRustErrorEffects(`
      type Identity = <Value>(value: Value) => Value;
      function make(callback: () => number): Identity {
        return <Value>(value: Value): Value => { callback(); return value; };
      }
      function compare(left: () => number, right: () => number): boolean {
        const first = make(left);
        const second = make(right);
        return first<number>(7) === 7 && second<string>("native") === "native";
      }
      export function main(): boolean { return compare(() => 1, () => 2); }
    `, { surfaces }));
    const declaration = current.declaration("compare");
    const inputs = current.program.callableValues.native.inputsFor(declaration);
    assert.equal(inputs.length, 2);
    const effects = current.callable("compare");
    assert.equal(effects.nativeErrors.length, 2);
    const callerEffects = current.callable("main");
    assert.equal(callerEffects.nativeErrors.length, 2);
    const references = rustTargetGenericReferences({ kind: "tuple",
      elements: callerEffects.nativeErrors.map(source => source.errorType) });
    assert.equal(inputs.some(input => references.typeIdentities.includes(input.implementation.identity)), false,
      "callee-only C0/C1 parameters cannot escape in a nested producer reference");
    const invocation = current.calls("compare")[0];
    const unresolved = createRustSourceErrorEffectSelection({ context: current.program });
    assert.equal(unresolved.register(effects.nativeErrors), true);
    const bindings = unresolved.bindingsFor(invocation, declaration,
      effects.nativeErrors.map(source => source.errorType));
    assert.equal(bindings !== undefined, true, "the actual logical activation is completed before physical payload admission");
    const requiredInputs = { kind: "tuple", elements: inputs.map(input => input.implementation) };
    assert.equal(bindings.complete(requiredInputs, { ...current.program.callableValues.nativeStorage,
      invocationInputFor: () => ({ kind: "unresolved", reason: "missing exact physical input" }) }) === undefined, true,
    "a concrete origin alone cannot replace missing physical ABI evidence");
    assert.equal(bindings.complete(requiredInputs, current.program.callableValues.nativeStorage) !== undefined, true,
      "the same actual native input payloads are admitted by their completed private construction owner");
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`source error signature inference keeps substituted caller binders rigid (${surfaces[0] ?? "native"})`, () => {
    const current = analyzedFixture(analyzeRustErrorEffects(`
      function invoke<Part>(callback: (value: Part) => void, value: Part): void {
        callback(value);
      }
      export function forward<Value>(value: Value): void {
        invoke((actual: Value): void => { void actual; }, value);
      }
    `, { surfaces }));
    const program = current.program;
    const callee = current.declaration("invoke");
    const caller = current.declaration("forward");
    const calls = current.calls("invoke");
    assert.equal(calls.length, 1, "the real checked generic invocation is unique");
    const call = calls[0];
    const selected = program.records.selectedCall.get(call);
    const operation = program.records.targetOperation.get(call);
    assert.equal(operation?.kind, "source-call", "the witness follows selected source-call analysis");
    const parameters = selected?.member.genericParameters?.filter(parameter => parameter.kind === "type");
    assert.equal(parameters?.length, 1, "invoke has one authored type binder");
    const formalIdentity = parameters[0].targetIdentity;
    const arguments_ = operation.targetGenericArguments?.filter(argument => argument.kind === "type");
    assert.equal(arguments_?.length, 1, "the invocation has one selected type argument");
    const callerCarrier = arguments_[0].type;
    assert.equal(callerCarrier.kind, "type-parameter", "Part is substituted by the enclosing caller's Value");
    const callerIdentity = callerCarrier.identity;
    assert.notEqual(callerIdentity, formalIdentity, "the caller and callee own distinct binders");
    const inputs = program.callableValues.native.inputsFor(callee);
    assert.equal(inputs.length, 1, "the callee has its actual callable input");
    const formalReferences = rustTargetGenericReferences(inputs[0].carrier);
    assert.equal(formalReferences.typeIdentities.includes(formalIdentity), true,
      "the original callable pattern contains Part");
    assert.equal(formalReferences.typeIdentities.includes(callerIdentity), false,
      "the original callable pattern does not own Value");
    const callerBindings = program.callableValues.native.bindingsFor(caller);
    assert.equal(callerBindings !== undefined, true, "the real caller has source bindings");
    const activation = program.sourceStorage.bindingsForInvocation(callee, call, callerBindings);
    assert.equal(activation.kind, "resolved", "the source owner selects the actual invocation activation");
    const generic = program.callableValues.nativeStorage.genericBindingsFor(callee, activation.bindings);
    assert.equal(generic.kind, "resolved", "the existing native owner selects the invocation generic environment");
    assert.equal(rustTargetTypeRefEquals(generic.bindings.types.get(formalIdentity), callerCarrier), true,
      "the selected environment already binds Part to Value");
    assert.equal(generic.bindings.types.has(callerIdentity), false,
      "the incoming environment does not propose re-inferring the caller binder");
    const effects = current.callable("invoke");
    assert.equal(effects.nativeErrors.length, 1, "the callable parameter contributes its exact native error channel");
    const selection = createRustSourceErrorEffectSelection({ context: program });
    assert.equal(selection.register(effects.nativeErrors), true, "the original native error source is registered");
    const bound = selection.bindingsFor(call, callee, effects.nativeErrors.map(error => error.errorType), {
      storageBindings: activation.bindings, genericBindings: generic.bindings,
    });
    assert.equal(bound !== undefined, true, "the real source error activation binds without changing caller ownership");
    assert.equal(bound.types.has(callerIdentity), false,
      "signature inference must not add the substituted caller-only binder to its solution");
    assert.equal(rustTargetTypeRefEquals(bound.types.get(formalIdentity), callerCarrier), true,
      "the original Part-to-Value binding remains exact");
    assert.equal(rustTargetTypeRefEquals(bound.substitute(callerCarrier), callerCarrier), true,
      "caller-owned Value stays rigid in subsequent error-carrier substitution");
  });
}

test("concrete callback errors retain exact producer declarations rather than the recipient package", () => {
  const current = fixture(`
    export class RootFailure extends Error { code = 7; }
    export function invoke(callback: () => number): number { return callback(); }
    export function main(): number {
      const pure = invoke(() => 7);
      const failure = invoke(() => { throw new RootFailure("retained"); });
      return pure + failure;
    }
  `);
  for (const name of ["pure", "failure"]) {
    const invocation = current.initializer(name);
    const producer = current.program.callableValues.nativeProducers.forDeclaration(current.ast.arguments(invocation)[0]);
    assert.equal(producer !== undefined, true);
    const edge = current.program.records.sourceErrorEffects.get(invocation).edges[0];
    assert.equal(edge.effects.localErrors, false, "recipient has no manufactured local error channel");
    assert.equal(edge.nativeErrors.length, 1);
    const reference = rustProducerErrorReference(edge.nativeErrors[0].target.errorType);
    assert.equal(reference.identity, producer.identity);
    assert.equal(reference.fileName, producer.fileName);
    assert.equal(reference.channel, "invoke");
    assert.equal(current.effects(producer.declaration).localErrors, name === "failure");
  }
});

test("pure source bodies stay pure while abstract input invocation carries its exact native error", () => {
  const current = fixture(`
    export function pure(): number { return 7; }
    export function invoke(callback: () => number): number { return callback(); }
    export function local(): number { throw new Error("local"); }
  `);
  assertChannels(current.callable("pure"), []);
  assertChannels(current.callable("local"), [], true);
  const native = current.program.callableValues.native.callFor(current.calls("callback")[0]);
  const expected = [{ identity: native.invocationErrorSource, errorType: native.invocationError }];
  assertChannels(current.callable("invoke"), expected);
  assertChannels(current.effects(current.calls("callback")[0]), expected);
  assert.equal(current.program.records.fallible.get(current.declaration("pure")) === undefined, true);
  assert.equal(current.program.records.fallible.get(current.declaration("invoke")) !== undefined, true);
});

for (const [name, body, callbacks, localErrors] of [
  ["one prepared callback", "[0].forEach(() => { left(value); });", ["left"], false],
  ["nested prepared callbacks", "[0].forEach(() => { [0].forEach(() => { left(value); }); });", ["left"], false],
  ["independent native errors", "[0].forEach(() => { left(value); right(value); });", ["left", "right"], false],
  ["native error with actual source throw", "[0].forEach(() => { left(value); throw new Error('local'); });", ["left"], true],
]) {
  test(`prepared provider effects preserve exact native error channels: ${name}`, () => {
    const current = analyzedFixture(analyzeRustErrorEffects(`
      export function deliver<Value>(left: (value: Value) => void, right: (value: Value) => void, value: Value): void {
        ${body}
      }
    `));
    const expected = callbacks.map(name => {
      const calls = current.calls(name);
      assert.equal(calls.length, 1, `${name}: the complete original source invocation`);
      const native = current.program.callableValues.native.callFor(calls[0]);
      assert.equal(native !== undefined, true, `${name}: exact original native callable input`);
      return { identity: native.invocationErrorSource, errorType: native.invocationError };
    });
    assertChannels(current.callable("deliver"), expected, localErrors);
    const prepared = current.nodes.filter(node => {
      if (!current.ast.is.IsCallExpression(node)) return false;
      const callee = Node_Expression(current.ast, node);
      const name = callee !== undefined && current.ast.is.IsPropertyAccessExpression(callee)
        ? current.ast.name(callee) : undefined;
      return name !== undefined && current.ast.is.IsIdentifier(name) && current.ast.text(name) === "forEach";
    });
    assert.equal(prepared.length, name === "nested prepared callbacks" ? 2 : 1,
      "every prepared operation remains in the checked source");
    for (const operation of prepared) assertChannels(current.effects(operation), expected, localErrors);
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`two callbacks retain independent invocation and await errors alongside a local throw (${surfaces[0] ?? "native"})`, () => {
    const current = fixture(`
      export async function pair(left: () => Promise<number>, right: () => Promise<number>, fail: boolean): Promise<number> {
        const first = left(); const second = right();
        const total = await first + await second;
        if (fail) throw new Error("local");
        return total;
      }
    `, { surfaces });
    const channels = current.program.callableValues.native.calls.flatMap(call => [
      { identity: call.invocationErrorSource, errorType: call.invocationError },
      ...call.awaitErrors.map((errorType, index) => ({ identity: call.awaitErrorSources[index], errorType })),
    ]);
    assert.equal(channels.length, 4, "both actual callbacks have invocation and deferred channels");
    const expected = [...new Map(channels.map(channel => [channel.identity, channel])).values()];
    assert.equal(expected.length, surfaces.length === 0 ? 4 : 3,
      "native producer errors stay distinct; only the canonical JS rejection is shared");
    if (surfaces.length !== 0) {
      const rejection = expected.find(channel => channel.identity === rustJsRejectionErrorIdentity);
      assert.equal(rejection !== undefined && rustTargetTypeRefEquals(rejection.errorType, rustJsValueTargetType()), true,
        "the shared await channel is precisely the canonical JsValue reason");
    }
    assertChannels(current.callable("pair"), expected, true);
    for (const name of ["left", "right"]) {
      const call = current.calls(name)[0];
      const native = current.program.callableValues.native.callFor(call);
      assertChannels(current.effects(call), [{ identity: native.invocationErrorSource, errorType: native.invocationError }]);
    }
  });
}

test("catch suppresses escaping native errors without losing try and finally region evidence", () => {
  const current = fixture(`
    export async function caught(left: () => Promise<number>, right: () => Promise<number>): Promise<number> {
      try { return await left(); } catch { return 0; } finally { await right(); }
    }
  `);
  const statement = current.nodes.find(node => current.ast.kindName(node) === "KindTryStatement");
  const native = name => current.program.callableValues.native.callFor(current.calls(name)[0]);
  const channels = call => [{ identity: call.invocationErrorSource, errorType: call.invocationError },
    { identity: call.awaitErrorSources[0], errorType: call.awaitErrors[0] }];
  assertChannels(current.effects(TryStatement_TryBlock(current.ast, statement)), channels(native("left")));
  assertChannels(current.effects(CatchClause_Block(current.ast, TryStatement_CatchClause(current.ast, statement))), []);
  assertChannels(current.effects(TryStatement_FinallyBlock(current.ast, statement)), channels(native("right")));
  assertChannels(current.callable("caught"), channels(native("right")));
});

test("nested source functions propagate captures only when invoked", () => {
  const current = analyzedFixture(analyzeRustErrorEffects(`
    export function dormant(callback: () => number): number {
      function hidden(): number { return callback(); } return 1;
    }
    export function active(callback: () => number): number {
      function inner(): number { return callback(); } return inner();
    }
  `));
  assertChannels(current.callable("dormant"), []);
  const hidden = current.declaration("hidden");
  assert.equal(current.program.records.nativeParticipation.get(hidden), "erased", "the actual unused lexical body is not native work");
  assert.equal(current.program.records.errorEffects.get(hidden) === undefined, true,
    "the erased native body has no fabricated native error region");
  const callback = current.calls("callback").find(call => current.ast.body(hidden) === current.ast.parent(current.ast.parent(call)));
  assert.equal(callback !== undefined, true, "the original checked unused callback invocation remains in the complete source");
  const subject = current.program.sourceStorage.subjectFor(Node_Expression(current.ast, callback));
  assert.equal(subject.kind, "resolved", "the erased invocation retains its exact checked source-storage subject");
  assert.equal(current.program.sourceStorage.typeFor(subject.subject).kind, "resolved",
    "native erasure never deletes the checked callback type evidence");
  assert.equal(current.callable("inner").nativeErrors.length, 1, "the actually invoked lexical body keeps its exact native channel");
  assertChannels(current.callable("active"), current.callable("inner").nativeErrors);
});

test("provider callback references remain pure evaluations without erasing invoked body effects", () => {
  const current = fixture(`
    export function fail(): void { throw new Error("original"); }
    export function register(): void {
      const callback = (): void => { throw new Error("original"); };
      setTimeout(fail, 0);
      setTimeout(callback, 0);
    }
  `);
  const call = current.calls("setTimeout")[0];
  const callback = current.ast.arguments(call)[0];
  assertChannels(current.callable("fail"), [], true);
  assert.equal(current.program.records.errorEffects.get(callback) === undefined, true,
    "evaluating a reference does not manufacture its referenced body's errors");
  assertChannels(current.effects(current.initializer("callback")), [], true);
  const registered = current.callable("register");
  assert.equal(registered.localErrors, false, "registration does not execute either throwing callback body");
  assert.equal(registered.nativeErrors.length, 1, "both registrations preserve their one native scheduling error channel");
  assert.equal(rustTargetTypeRefEquals(registered.nativeErrors[0].errorType, rustJsErrorTargetType()), true,
    "the native scheduling API returns JsResult, not the callback's package-local error");
  for (const invocation of current.calls("setTimeout")) {
    const operation = current.program.records.targetOperation.get(invocation);
    assert.equal(operation?.kind, "provider-operation");
    assert.equal(operation.abi.effects.errorBoundary, "provider-native");
    assert.equal(rustTargetTypeRefEquals(operation.abi.effects.errorCarrier, rustJsErrorTargetType()), true,
      "the selected provider ABI retains the exact native scheduling error");
    assertChannels(current.effects(invocation), registered.nativeErrors);
  }
});

test("call edges rebind two same-signature formals to physical caller inputs without rebranding the callee trait", () => {
  const current = fixture(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(left: () => number, right: () => number): number {
      const first = invoke(left); const second = invoke(right); return first + second;
    }
  `);
  const source = current.callable("invoke").nativeErrors[0];
  const inputs = current.program.callableValues.native.inputsFor(current.declaration("forward"));
  const expected = [];
  for (const [index, name] of ["first", "second"].entries()) {
    const call = current.initializer(name);
    const selected = current.program.records.sourceErrorEffects.get(call);
    assert.equal(selected?.edges.length, 1);
    const edge = selected.edges[0];
    assert.equal(edge.declaration === current.declaration("invoke"), true);
    assert.equal(edge.kind, "invoke");
    assert.equal(edge.nativeErrors.length, 1);
    const route = edge.nativeErrors[0];
    assert.equal(route.source.identity, source.identity);
    assert.equal(route.target.errorType.kind, "associated-type");
    assert.equal(route.target.errorType.owner.identity, inputs[index].implementation.identity);
    assert.equal(route.target.errorType.trait.id, source.errorType.trait.id);
    assert.equal(route.target.errorType.trait.id, inputs[index].trait.id);
    assert.notEqual(route.target.errorType.owner.identity, source.errorType.owner.identity);
    assertChannels(current.effects(call), [route.target]);
    expected.push(route.target);
  }
  assert.notEqual(expected[0].identity, expected[1].identity);
  assertChannels(current.callable("forward"), expected);
});

test("source error rebinding rejects unknown identities, mutated carriers and unselected inputs", () => {
  const current = analyzedFixture(analyzeRustErrorEffects(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(callback: () => number): number { const output = invoke(callback); return output; }
  `));
  const selection = createRustSourceErrorEffectSelection({ context: current.program });
  const select = (node, declaration, kind, effects) => selection.edgeFor(declaration, kind, effects,
    selection.bindingsFor(node, declaration, effects.nativeErrors.map(error => error.errorType)));
  const effects = current.callable("invoke");
  const declaration = current.declaration("invoke");
  const call = current.initializer("output");
  assert.equal(select(call, declaration, "invoke", effects) !== undefined, true);
  const source = effects.nativeErrors[0];
  for (const mutation of [
    { ...source, identity: "foreign/source" },
    { ...source, errorType: { ...source.errorType, name: "ForeignError" } },
    { ...source, errorType: { ...source.errorType, trait: { ...source.errorType.trait, id: "foreign/trait" } } },
  ]) assert.equal(select(call, declaration, "invoke", { ...effects, nativeErrors: [mutation] }) === undefined, true,
    "identity and carrier must agree with the exact sealed native source");
  assert.equal(select(current.calls("callback")[0], declaration, "invoke", effects) === undefined, true,
    "an unselected invocation cannot supply another declaration's input binding");
});

test("completed source rejection channels keep their identity before physical publication", () => {
  const current = analyzedFixture(analyzeRustErrorEffects(`
    export function value(): number { return 7; }
    export function forward(): number { const output = value(); return output; }
  `));
  const selection = createRustSourceErrorEffectSelection({ context: current.program });
  const declaration = current.declaration("value");
  const source = { identity: rustJsRejectionErrorIdentity, errorType: rustJsValueTargetType() };
  const effects = { localErrors: false, nativeErrors: [source] };
  const bindings = selection.bindingsFor(current.initializer("output"), declaration, [source.errorType]);
  assert.equal(bindings !== undefined, true, "the exact checked source invocation is ready");
  const edge = selection.edgeFor(declaration, "await", effects, bindings);
  assert.equal(edge !== undefined, true, "the source channel is selected without physical readers");
  assert.equal(edge.nativeErrors.length, 1, "one source channel remains one channel");
  const target = edge.nativeErrors[0].target;
  assert.equal(target.identity, rustJsRejectionErrorIdentity, "a completed canonical channel cannot become a pending identity");
  assert.equal(rustTargetTypeRefEquals(target.errorType, source.errorType), true, "the exact source payload is retained");
  const completed = selection.complete(target, {
    invocationInputFor: () => assert.fail("a closed source channel has no physical invocation dependency"),
    boundSubjectFor: () => assert.fail("a closed source channel has no physical storage dependency"),
  });
  assert.equal(completed === target, true, "late physical completion does not replace an already completed source channel");
});

test("a pending source channel stays deferred even when its payload is already closed", () => {
  const current = analyzedFixture(analyzeRustErrorEffects(`
    export function value(): number { return 7; }
    export function forward(): number { const output = value(); return output; }
  `));
  const selection = createRustSourceErrorEffectSelection({ context: current.program });
  const declaration = current.declaration("value");
  const source = { identity: "test/pending-source-channel", errorType: rustJsValueTargetType() };
  let completions = 0;
  assert.equal(selection.pending(source, () => {
    completions++;
    return { identity: rustJsRejectionErrorIdentity, errorType: rustJsValueTargetType() };
  }), true, "the original source owns its unresolved identity");
  const bindings = selection.bindingsFor(current.initializer("output"), declaration, [source.errorType]);
  const edge = selection.edgeFor(declaration, "await", { localErrors: false, nativeErrors: [source] }, bindings);
  assert.equal(edge !== undefined, true, "pending source rebinding is represented explicitly");
  const target = edge.nativeErrors[0].target;
  assert.equal(target.identity.startsWith("pending-native-error:"), true, "a closed payload alone cannot complete its pending source");
  assert.equal(completions, 0, "the source phase cannot read the pending physical channel");
  const completed = selection.complete(target, {
    invocationInputFor: () => assert.fail("this pending identity has no physical input dependency"),
    boundSubjectFor: () => assert.fail("this pending identity has no physical storage dependency"),
  });
  assert.equal(completed?.identity, rustJsRejectionErrorIdentity, "the original completion supplies the final identity");
  assert.equal(completions, 1, "one pending source is completed once");
});

test("source rebinding retains pending generic payloads until their physical completion", () => {
  const current = analyzedFixture(analyzeRustErrorEffects(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(callback: () => number): number { const output = invoke(callback); return output; }
  `));
  const selection = createRustSourceErrorEffectSelection({ context: current.program });
  const declaration = current.declaration("invoke");
  const effects = current.callable("invoke");
  const bindings = selection.bindingsFor(current.initializer("output"), declaration,
    effects.nativeErrors.map(error => error.errorType));
  const edge = selection.edgeFor(declaration, "invoke", effects, bindings);
  assert.equal(edge !== undefined, true, "the actual selected callback channel can be rebound");
  assert.equal(edge.nativeErrors.length, 1, "the real formal channel is preserved");
  const target = edge.nativeErrors[0].target;
  assert.equal(rustTargetGenericReferences(target.errorType).typeIdentities.length > 0, true,
    "the caller's physical native parameter remains explicit");
  assert.equal(target.identity.startsWith("pending-native-error:"), true,
    "an open physical payload cannot be mistaken for a completed closed channel");
  const completed = selection.complete(target, current.program.callableValues.nativeStorage);
  assert.equal(completed !== undefined, true, "the same completed physical owner supplies the payload");
  assert.equal(rustTargetTypeRefEquals(completed.errorType, target.errorType), true,
    "completion preserves the actual caller-bound payload");
});

for (const surfaces of [[], ["js"]]) {
  test(`source async invocation remains pure while exact rebound errors belong to awaiting (${surfaces[0] ?? "native"})`, () => {
    const current = fixture(`
      export async function invoke(callback: () => Promise<number>): Promise<number> { return await callback(); }
      export async function forward(callback: () => Promise<number>): Promise<number> {
        const pending = invoke(callback); return await pending;
      }
    `, { surfaces });
    const call = current.initializer("pending");
    assertChannels(current.effects(call), []);
    const selected = current.program.records.sourceErrorEffects.get(call);
    const awaited = selected?.edges.find(edge => edge.kind === "await");
    assert.equal(awaited !== undefined, true);
    assert.equal(awaited.effects.nativeErrors.length, 2,
      "the selected native async body retains both its invocation and deferred errors");
    const input = current.program.callableValues.native.inputsFor(current.declaration("forward"))[0];
    assert.equal(awaited.effects.nativeErrors.some(error => error.errorType.kind === "associated-type" &&
      error.errorType.name === "InvocationError" && error.errorType.owner.identity === input.implementation.identity), true,
    "the native body preserves its original caller-bound synchronous invocation failure");
    if (surfaces.length !== 0) {
      const operation = current.program.records.targetOperation.get(call);
      assert.equal(operation.kind, "source-call");
      assert.equal(operation.asyncBody !== undefined, true, "the actual selected source call uses its native body");
      assert.equal(operation.resultCarrier.id, "rust.core.Future", "the direct call does not allocate a public JsPromise");
      const rejections = awaited.effects.nativeErrors.filter(error => error.identity === rustJsRejectionErrorIdentity);
      assert.equal(rejections.length, 1, "the callback's public promise rejection retains one canonical channel");
      assert.equal(rustTargetTypeRefEquals(rejections[0].errorType, rustJsValueTargetType()), true,
        "the canonical JS rejection is distinct from the native body's invocation failure");
    }
    assertChannels(current.callable("forward"), awaited.effects.nativeErrors);
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`a synchronously returned input future transports its deferred error into the caller physical identity (${surfaces[0] ?? "native"})`, () => {
    const current = fixture(`
      export function retain(callback: () => Promise<number>): Promise<number> { return callback(); }
      export async function invoke(callback: () => Promise<number>): Promise<number> {
        const future = retain(callback); return await future;
      }
    `, { surfaces });
    const callee = current.program.callableValues.native.inputsFor(current.declaration("retain"))[0];
    const caller = current.program.callableValues.native.inputsFor(current.declaration("invoke"))[0];
    const effects = current.callable("invoke");
    assert.equal(effects.localErrors, false);
    assert.equal(effects.nativeErrors.length, 2, "invocation and deferred errors are independent channels");
    const nativeErrors = surfaces.length === 0 ? effects.nativeErrors
      : effects.nativeErrors.filter(source => source.identity !== rustJsRejectionErrorIdentity);
    assert.equal(nativeErrors.length, surfaces.length === 0 ? 2 : 1,
      "the JS public rejection does not erase the exact caller-bound invocation error");
    assert.equal(nativeErrors.every(source => source.errorType.kind === "associated-type" &&
      source.errorType.owner.identity === caller.implementation.identity), true,
      "no callee physical binder may escape across a selected source return");
    assert.equal(nativeErrors.every(source => source.errorType.trait.id === callee.protocol.trait.id), true,
      "selected return transport preserves the callee protocol instead of rebranding it");
    if (surfaces.length !== 0) {
      const rejection = effects.nativeErrors.find(source => source.identity === rustJsRejectionErrorIdentity);
      assert.equal(rejection !== undefined && rustTargetTypeRefEquals(rejection.errorType, rustJsValueTargetType()), true,
        "only the deferred JS reason uses the canonical physical rejection");
    }
  });
}

test("selected source generic arguments substitute callee protocol environments at the error owner", () => {
  const current = fixture(`
    export function invoke<Value>(callback: () => Value): Value { return callback(); }
    export function forward(callback: () => number): number { const output = invoke(callback); return output; }
  `);
  const call = current.initializer("output");
  const edge = current.program.records.sourceErrorEffects.get(call).edges[0];
  const source = edge.nativeErrors[0].source;
  const target = edge.nativeErrors[0].target;
  assert.equal(source.errorType.trait.id, target.errorType.trait.id);
  assert.equal(source.errorType.trait.genericArguments.length, 1);
  assert.equal(target.errorType.trait.genericArguments.length, 1);
  assert.equal(rustTargetTypeRefEquals(source.errorType.trait.genericArguments[0].type,
    target.errorType.trait.genericArguments[0].type), false);
  const operation = current.program.records.targetOperation.get(call);
  assert.equal(rustTargetTypeRefEquals(target.errorType.trait.genericArguments[0].type, operation.resultCarrier), true);
  assertChannels(current.callable("forward"), [target]);
});

test("distinct callee formal channels survive forwarding the same actual callback twice", () => {
  const current = fixture(`
    export function pair(left: () => number, right: () => number): number { return left() + right(); }
    export function forward(callback: () => number): number { const output = pair(callback, callback); return output; }
  `);
  const edge = current.program.records.sourceErrorEffects.get(current.initializer("output")).edges[0];
  assert.equal(edge.nativeErrors.length, 2);
  const first = edge.nativeErrors[0];
  const second = edge.nativeErrors[1];
  assert.notEqual(first.source.identity, second.source.identity);
  assert.notEqual(first.target.identity, second.target.identity);
  assert.equal(first.target.errorType.owner.identity, second.target.errorType.owner.identity);
  assertChannels(current.callable("forward"), [first.target, second.target]);
});

test("recursive forwarding converges to one exact source channel rather than accumulating call path identities", () => {
  const current = fixture(`
    export function recurse(callback: () => number, depth: number): number {
      if (depth <= 0) return callback();
      return recurse(callback, depth - 1);
    }
  `);
  const effects = current.callable("recurse");
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 1);
  assertChannels(current.effects(current.calls("recurse")[0]), effects.nativeErrors);
});

test("deferred expression body aggregates argument errors but invocation fact excludes eager argument evaluation", () => {
  const current = fixture(`
    export function fail(): number { throw new Error("argument"); }
    export function make(callback: (value: number) => number): () => number {
      const invoke = (): number => callback(fail()); return invoke;
    }
  `);
  const lambda = current.initializer("invoke");
  const declaration = current.effects(lambda);
  assert.equal(declaration.localErrors, true);
  assert.equal(declaration.nativeErrors.length, 1);
  assertChannels(current.effects(current.calls("callback")[0]), declaration.nativeErrors);
  assertChannels(current.callable("make"), []);
});

test("production package forwarding preserves errors independently of an unrelated root Error subclass", () => {
  for (const extra of ["", "export class RootFailure extends Error { code = 11; }"]) {
    const source = `
      import { forwarded, consume } from "@acme/forward";
      ${extra}
      export function pair(left: () => number, right: () => number): number {
        const first = forwarded(left); const second = forwarded(right);
        return consume(first) + consume(second);
      }
    `;
    const current = fixture(source, { sourcePackages: sourcePackageCallbackErrorGraph,
      files: { ...sourcePackageCallbackErrorFiles, "index.ts": source } });
    assertChannels(current.callable("retain"), []);
    assertChannels(current.callable("forwarded"), []);
    const invoke = current.callable("invoke");
    const consume = current.callable("consume");
    const pair = current.callable("pair");
    assert.equal(invoke.localErrors || consume.localErrors || pair.localErrors, false);
    assert.equal(invoke.nativeErrors.length, 1);
    assert.equal(consume.nativeErrors.length, 1);
    assert.equal(pair.nativeErrors.length, 2);
    for (const effect of pair.nativeErrors) assert.equal(effect.errorType.trait.id, invoke.nativeErrors[0].errorType.trait.id);
    assert.equal(pair.nativeErrors[0].identity !== pair.nativeErrors[1].identity, true);
  }
});

test("first-class value calls do not execute a function-type descriptor as a declaration", () => {
  const current = fixture(`
    export function retain(callback: () => number): () => number { return callback; }
    export function run(): void {
      const callback = retain(() => { throw new Error("original"); });
      try { callback(); } catch {}
    }
  `);
  const call = current.calls("callback")[0];
  assert.equal(current.effects(call).localErrors, true);
  assert.equal(current.program.records.sourceErrorEffects.get(call) === undefined, true,
    "the callable ABI, not a type-only declaration edge, owns this invocation");
});
