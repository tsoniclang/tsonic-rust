import assert from "node:assert/strict";
import test from "node:test";
import { rustFutureValueForOperation } from "../../../dist/analysis/callables/future-values.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { rustJsPromiseTargetType, rustSourcePrimitiveTargetType, rustJsValueTargetType,
  rustNamedTargetType, rustProgramErrorTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { Node_Expression } from "@tsonic/target-api/source";

test("source JS calls use their Promise rejection channel rather than body-local fallibility", () => {
  const promise = rustJsPromiseTargetType(rustSourcePrimitiveTargetType("uint64"));
  for (const awaiting of ["infallible", "fallible"]) {
    const selected = rustFutureValueForOperation({ kind: "source-call", resultCarrier: promise },
      { invocation: "infallible", awaiting });
    assert.equal(selected !== undefined, true, awaiting);
    assert.equal(selected.awaiting, "fallible", awaiting);
    assert.equal(selected.errorBoundary, "js-rejection", awaiting);
    assert.equal(Object.hasOwn(selected, "errorCarrier"), false, awaiting);
  }
});

test("known infallible async producers retain their native bodies without rejection effects", () => {
  const context = analyzeRustErrorEffects(`
    async function first(): Promise<number> { return 1; }
    async function second(): Promise<string> { return "two"; }
    export async function both(): Promise<number> {
      const one = await first();
      const two = await second();
      return one + two.length;
    }
  `);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "both");
  assert.equal(declaration !== undefined, true);
  const calls = context.sourceStorage.nodes.filter(node => context.ast.is.IsCallExpression(node) &&
    ["first", "second"].includes(context.ast.text(Node_Expression(context.ast, node))));
  assert.equal(calls.length, 2, "both original async producers are invoked");
  for (const call of calls) assert.equal(context.records.targetOperation.get(call)?.asyncBody !== undefined, true,
    "the checked producer selects its genuine native body");
  const effects = context.records.errorEffects.get(declaration);
  assert.equal(effects !== undefined, true);
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 0, "infallible native bodies do not manufacture a rejection channel");
});

test("multiple JS Promise inputs contribute one uniform rejection effect", () => {
  const context = analyzeRustErrorEffects(`
    export async function both(first: Promise<number>, second: Promise<string>): Promise<number> {
      const one = await first;
      const two = await second;
      return one + two.length;
    }
  `);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "both");
  assert.equal(declaration !== undefined, true);
  const effects = context.records.errorEffects.get(declaration);
  assert.equal(effects !== undefined, true);
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 1);
  assert.equal(effects.nativeErrors[0].identity, "js-rejection");
  assert.equal(rustTargetTypeRefEquals(effects.nativeErrors[0].errorType, rustJsValueTargetType()), true);
});

const capturedResolverPrograms = [
  ["reduce-accumulator-remains-number", "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => { [value].reduce((accumulator, actual) => { void actual; resolve(accumulator); return accumulator; }, 7); });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"],
  ["sort-callback-never-resolves-captured-Value", "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => { [1, 2].sort((left, right) => { void value; resolve(left + right + 4); return 0; }); });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"],
  ["non-resolving-native-observer", "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    [0].forEach(() => { void value; });\n    resolve(7);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"],
];

for (const [name, source] of capturedResolverPrograms) {
  test(`captured resolver invocation retains its actual JsValue error: ${name}`, () => {
    const context = analyzeRustErrorEffects("export {};\n" + source, {
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_inverse" } },
    });
    const invocations = context.sourceStorage.nodes.filter(node => {
      const operation = context.records.targetOperation.get(node);
      return operation?.kind === "source-call" && operation.target.form === "callable" &&
        rustTargetTypeRefEquals(rustCallableProtocol(operation.target.carrier)?.error, rustJsValueTargetType());
    });
    assert.equal(invocations.length, 1, "the original checked program has one captured resolver invocation");
    for (const node of invocations) {
      const effects = context.records.errorEffects.get(node);
      assert.equal(effects !== undefined, true, "the selected native call publishes exact effects");
      assert.equal(effects.localErrors, false, "JsValue is not silently replaced with TsonicError");
      assert.equal(effects.nativeErrors.length, 1, "one actual native error channel");
      assert.equal(effects.nativeErrors[0].identity, "js-rejection", "the existing rejection identity is reused");
      assert.equal(rustTargetTypeRefEquals(effects.nativeErrors[0].errorType, rustJsValueTargetType()), true,
        "the complete native error carrier survives");
    }
  });
}

for (const [name, source] of [
  ["callback-signature-alone-does-not-prove-resolver", "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    const observer = (actual: Value): void => { void actual; };\n    [value].forEach(observer);\n    resolve(7);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"],
  ["authored-this-nonresolver", "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { function observe(this: void, actual: Value): void { void actual; } [value].forEach(observe); resolve(7); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"],
]) {
  test(`prepared native callbacks retain their invocation channel independently of resolver effects: ${name}`, () => {
    const context = analyzeRustErrorEffects("export {};\n" + source, {
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_inverse" } },
    });
    const invocations = context.sourceStorage.nodes.filter(node => {
      const operation = context.records.targetOperation.get(node);
      return operation?.kind === "provider-operation" && operation.operationId === "tsonic.rust.js.Array.forEach.call.value";
    });
    assert.equal(invocations.length, 1, "the original source has exactly one prepared native callback invocation");
    const invocation = invocations[0];
    const callback = context.ast.arguments(invocation)[0];
    const callbackError = rustCallableProtocol(context.records.runtimeCarrier.get(callback)?.carrier)?.error;
    assert.equal(rustTargetTypeRefEquals(callbackError, rustProgramErrorTargetType()), true,
      "the selected stored callback retains its exact native program-error ABI despite its pure body");
    const effects = context.records.errorEffects.get(invocation);
    assert.equal(effects !== undefined, true, "the prepared invocation publishes its actual native effects");
    assert.equal(effects.localErrors, true, "the selected native callback channel is not erased by pure implementation effects");
    assert.equal(effects.nativeErrors.length, 0, "the sibling resolver channel is not attributed to this separate invocation");
    const resolvers = context.sourceStorage.nodes.filter(node => {
      const operation = context.records.targetOperation.get(node);
      return operation?.kind === "source-call" && operation.target.form === "callable" &&
        rustTargetTypeRefEquals(rustCallableProtocol(operation.target.carrier)?.error, rustJsValueTargetType());
    });
    assert.equal(resolvers.length, 1, "the independent checked resolver invocation is retained");
    const resolverEffects = context.records.errorEffects.get(resolvers[0]);
    assert.equal(resolverEffects !== undefined, true, "the resolver publishes its own native error selection");
    assert.equal(resolverEffects.localErrors, false, "a genuine JsValue resolver error is not relabelled as a local error");
    assert.equal(resolverEffects.nativeErrors.length, 1, "the resolver keeps exactly one rejection channel");
    assert.equal(resolverEffects.nativeErrors[0].identity, "js-rejection");
    assert.equal(rustTargetTypeRefEquals(resolverEffects.nativeErrors[0].errorType, rustJsValueTargetType()), true,
      "the full native resolver error remains unchanged");
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_inverse" } },
      files: { "index.ts": "export {};\n" + source } });
    assert.equal(result.diagnostics.length, 0, "the complete native program retains the admitted invocation and rejection conversions");
    const joins = result.program.records.nativeErrorJoinDeclarations.get("/src/index.ts");
    assert.equal(joins !== undefined, true, "the actual source module has its sealed native join inventory");
    assert.equal(joins.some(declaration => declaration.arity > 1), false,
      "direct Promise rejection conversion does not demand an unused native error-join declaration");
  });
}

for (const [name, error, localErrors, nativeErrors] of [
  ["uninhabited", rustNamedTargetType(rustInfallibleTargetId, "Infallible"), false, 0],
  ["local program", rustProgramErrorTargetType(), true, 0],
  ["native payload", rustNamedTargetType("fixture.CallbackFailure", "CallbackFailure"), false, 1],
]) {
  test(`stored callable invocation preserves its exact ${name} channel`, () => {
    const integer = rustSourcePrimitiveTargetType("int32");
    const callback = { kind: "function", id: "fixture.callback", parameters: [{ name: "value", type: integer }], returnType: integer };
    const provider = createRustProviderPackage({ id: "callback-errors", version: "1.0.0", displayName: "Callback errors",
      crates: [], modules: [{ moduleSpecifier: "test:callback-errors", providerModuleId: "test.callback-errors", exports: [{
        id: "fixture.makeCallback", name: "makeCallback", kind: "function", signatures: [{
          id: "fixture.makeCallback()", parameters: [], returnType: callback,
        }],
      }] }], operations: [{ exportId: "fixture.makeCallback", operationKind: "method",
        target: { form: "call", path: "fixture::make_callback" }, parameterCarriers: [],
        resultCarrier: rustCallableTargetType([integer], integer, { kind: "static" }, error) }],
    });
    const context = analyzeRustErrorEffects(`
      import { makeCallback } from "test:callback-errors";
      import type { int32 } from "@tsonic/core/types.js";
      export function run(value: int32): int32 { const callback = makeCallback(); return callback(value); }
    `, { packages: [provider] });
    const invocation = context.sourceStorage.nodes.find(node => {
      if (!context.ast.is.IsCallExpression(node)) return false;
      const expression = Node_Expression(context.ast, node);
      return expression !== undefined && context.ast.is.IsIdentifier(expression) && context.ast.text(expression) === "callback";
    });
    assert.equal(invocation !== undefined, true, "the native callback is invoked at its real checked source use");
    const operation = context.records.targetOperation.get(invocation);
    assert.equal(operation?.kind === "source-call" && operation.target.form === "callable", true,
      "the effect is selected from the native callable, not a body or provider-name guess");
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(operation.target.carrier)?.error, error), true,
      "the selected provider contract retains its complete native error");
    const effects = context.records.errorEffects.get(invocation);
    assert.equal(effects !== undefined, true, "the invocation has a sealed effect");
    assert.equal(effects.localErrors, localErrors, "only a genuine local native channel is local");
    assert.equal(effects.nativeErrors.length, nativeErrors, "uninhabited errors do not manufacture a failure");
    if (nativeErrors !== 0) assert.equal(rustTargetTypeRefEquals(effects.nativeErrors[0].errorType, error), true,
      "the original native payload is not converted or erased");
  });
}

test("a resolver channel does not erase an independent local throw from the callback", () => {
  const context = analyzeRustErrorEffects(`
    export function run(value: number): Promise<number> {
      return new Promise<number>(resolve => {
        [value].reduce((accumulator, actual) => {
          if (actual < 0) throw new Error("negative");
          resolve(accumulator);
          return accumulator;
        }, 7);
      });
    }
  `);
  const callback = context.sourceStorage.nodes.find(node => context.ast.is.IsArrowFunction(node) &&
    context.ast.parameters(node).length === 2);
  assert.equal(callback !== undefined, true, "the checked reducing callback is retained");
  const effects = context.records.errorEffects.get(callback);
  assert.equal(effects !== undefined, true, "the complete callback error set is published");
  assert.equal(effects.localErrors, true, "the actual local throw is preserved independently");
  assert.equal(effects.nativeErrors.some(source => source.identity === "js-rejection" &&
    rustTargetTypeRefEquals(source.errorType, rustJsValueTargetType())), true,
  "the independent exact resolver rejection remains present too");
});
