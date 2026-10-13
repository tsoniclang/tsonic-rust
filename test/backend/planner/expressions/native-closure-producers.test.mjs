import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosureProducerFixture, printNativeClosureProducer, nativeClosureProducerErrorRecords }
  from "../../../helpers/native-closure-producers.mjs";

import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../../dist/target-model/types/carriers/native.js";
import { printRustType } from "../../../../dist/print/source/types.js";


import { rustSourcePrimitiveTargetType, rustClosureTargetType, rustCallableInputProtocol, rustCallableInputTargetType }
  from "../../../../dist/target-model/types/index.js";
import { rustGenericCallableValue } from "../../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallableConstructionType } from "../../../../dist/backend/planner/expressions/fundamentals.js";
import { rustNativeCompletionFutureType } from "../../../../dist/target-model/types/callable-completions.js";
import { rustTypeGenericArguments } from "../../../../dist/target-model/types/generic-arguments.js";

const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", []);
const ownFailure = nativeClosureProducerErrorRecords(failure);

function producerCarrierRecords(carrier) {
  return (records, producer) => ({ ...records,
    targetOperation: { get: node => node === producer
      ? { ...records.targetOperation.get(node), resultCarrier: carrier } : records.targetOperation.get(node) },
    runtimeCarrier: { get: node => node === producer ? { carrier } : records.runtimeCarrier.get(node) },
  });
}

test("pure closure construction owns Infallible instead of inheriting the consumer's error", () => {
  const fixture = nativeClosureProducerFixture();
  const text = printNativeClosureProducer(fixture);
  assert.match(text, /rt::Callable::<\(\), Result<i32, core::convert::Infallible>>::new/u);
  assert.match(text, /Ok::<_, core::convert::Infallible>\(3\)/u);
  assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult|clone|Box/u);
  assert.equal(fixture.bodyContexts.length, 1);
  assert.equal(fixture.bodyContexts[0].fallibleBoundary === undefined, true, "pure body has no invented error region");
});

test("fallible closure construction and body retain the producer's exact native error", () => {
  const fixture = nativeClosureProducerFixture({ selectRecords: ownFailure });
  const text = printNativeClosureProducer(fixture);
  assert.match(text, /rt::Callable::<\(\), Result<i32, ProducerFailure>>::new/u);
  assert.match(text, /Ok::<_, ProducerFailure>\(3\)/u);
  assert.equal(printRustType(fixture.bodyContexts[0].fallibleBoundary.errorType), "ProducerFailure");
  assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult|clone|Box/u);
});

for (const throwing of [false, true]) {
    test(`JS Promise creation separates pure invocation from ${throwing ? "fallible" : "pure"} body`, () => {
      const fixture = nativeClosureProducerFixture({ asynchronous: true, surfaces: ["js"],
        ...(throwing ? { selectRecords: ownFailure } : {}),
      });
      const text = printNativeClosureProducer(fixture);
      const error = throwing ? "ProducerFailure" : "core::convert::Infallible";
      assert.match(text, new RegExp(`Ok::<_, ${error}>\\(3\\)`, "u"));
      assert.match(text, /Ok::<_, core::convert::Infallible>\(/u);
      assert.equal(fixture.bodyContexts[0].asyncContext, true);
      assert.equal(fixture.bodyContexts[0].fallibleBoundary === undefined, !throwing);
      assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult|Box|\.clone\(/u);
      assert.match(text, /from_fallible_factory/u);
      assert.match(text, new RegExp(`JsPromise<'static, i32, ${error}>`, "u"));
    });
}

test("native future closures remain delegated to their sealed generic implementation owner", () => {
  const fixture = nativeClosureProducerFixture({ asynchronous: true });
  const operation = fixture.program.records.targetOperation.get(fixture.node);
  assert.equal(rustGenericCallableValue(operation.resultCarrier) !== undefined, true);
  const implementation = fixture.program.callableValues.generic.implementationFor(fixture.node);
  assert.equal(implementation !== undefined, true);
  const text = printNativeClosureProducer(fixture);
  assert.equal(text.includes(implementation.variantName), true, "exact sealed implementation remains selected");
  assert.equal(fixture.bodyContexts.length, 0, "generic implementation body is not duplicated in expression emission");
  assert.doesNotMatch(text, /rt::Callable|ConsumerFailure/u);
});

test("nonretaining closure inputs keep their borrowed native representation and exact pure result", () => {
  const carrier = rustCallableInputTargetType([], rustSourcePrimitiveTargetType("int32"));
  const fixture = nativeClosureProducerFixture({ selectRecords: producerCarrierRecords(carrier) });
  const operation = fixture.program.records.targetOperation.get(fixture.node);
  assert.equal(rustCallableInputProtocol(operation.resultCarrier) !== undefined, true, "borrowed callable input selected");
  const text = printNativeClosureProducer(fixture);
  assert.match(text, /move \|_callable_arguments: \(\)\| Ok::<_, core::convert::Infallible>\(3\)/u);
  assert.doesNotMatch(text, /Callable::|::new|Rc::|Box|clone/u);
});

test("suspended closure body retains the existing shared-state invocation owner", () => {
  const fixture = nativeClosureProducerFixture({ surfaces: ["js"], source: `
import type { int32 } from "@tsonic/core/types.js";
export function create(value: int32): () => Promise<int32> {
  return async (): Promise<int32> => { return value; };
}
` });
  const capture = fixture.program.records.closureCapture.get(fixture.node);
  assert.equal(capture.invocationOwner, "shared-state");
  const expression = fixture.plan();
  assert.equal(expression !== undefined, true, fixture.context.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
  assert.equal(expression.kind === "closure" || expression.kind === "closure-block", true);
  assert.equal(expression.params.length, 2, "existing state and argument tuple convention retained");
  assert.equal(fixture.bodyContexts.length, 1);
  assert.equal(fixture.bodyContexts[0].fallibleBoundary === undefined, true);
});

test("recursive closure construction retains one recursive owner with the exact error channel", () => {
  const fixture = nativeClosureProducerFixture({ selectRecords: ownFailure, source: `
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 {
  const callback: () => int32 = (): int32 => { return callback(); };
  return callback;
}
` });
  const capture = fixture.program.records.closureCapture.get(fixture.node);
  assert.equal(capture.recursiveDeclaration !== undefined, true);
  const text = printNativeClosureProducer(fixture);
  assert.match(text, /rt::Callable::<\(\), Result<i32, ProducerFailure>>::recursive/u);
  assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult/u);
});

for (const [label, carrier, expected] of [
  ["function pointer", { kind: "function-pointer", args: [], result: rustSourcePrimitiveTargetType("int32") }, "|| 3"],
  ["native closure", rustClosureTargetType([], rustSourcePrimitiveTargetType("int32")), "|| 3"],
  ["explicit native fallible closure", rustClosureTargetType([], rustSourcePrimitiveTargetType("int32"), true), "|| Ok(3)"],
]) {
  test(`${label} keeps its native call ABI without a runtime storage wrapper`, () => {
    const fixture = nativeClosureProducerFixture({ selectRecords: producerCarrierRecords(carrier) });
    const text = printNativeClosureProducer(fixture);
    assert.equal(text, expected);
    assert.doesNotMatch(text, /rt::|ConsumerFailure|Box|clone/u);
  });
}

test("closure construction rejects missing error evidence rather than selecting the ambient error", () => {
  const fixture = nativeClosureProducerFixture({
    selectRecords: (records, producer) => ({ ...records, errorEffects: {
      get: node => node === producer ? undefined : records.errorEffects.get(node),
    } }),
  });
  assert.equal(fixture.plan() === undefined, true, "missing error fact rejects");
  assert.equal(fixture.bodyContexts.length, 0, "invalid producer never plans its body");
  assert.equal(fixture.context.diagnostics.length, 1);
  assert.match(fixture.context.diagnostics[0].message, /finalized native error region/u);
});

for (const method of ["errorFor", "physicalFor"]) {
  test(`closure construction rejects missing producer ${method} evidence`, () => {
    const fixture = nativeClosureProducerFixture({ selectProducers: plan => ({ ...plan, [method]: () => undefined }) });
    assert.equal(fixture.plan() === undefined, true, method);
    assert.equal(fixture.bodyContexts.length, 0);
    assert.equal(fixture.context.diagnostics.length, 1);
  });
}

test("closure constructors infer anonymous native payloads without changing their selected carrier", () => {
  const fixture = nativeClosureProducerFixture();
  const integer = rustSourcePrimitiveTargetType("int32");
  const future = rustNativeCompletionFutureType({ identity: "fixture:future", output: integer, error: failure, captures: [] });
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future, failure]));
  const callable = rustNamedTargetType("rust.runtime.Callable", "rt::Callable",
    rustTypeGenericArguments([{ kind: "tuple", elements: [integer] }, result]));
  const owner = rustCallableConstructionType(callable, fixture.context);
  assert.equal(owner !== undefined, true);
  assert.equal(printRustType(owner), "rt::Callable<(i32,), _>");
  assert.equal(rustNamedTypeCarrierValue(callable).genericArguments[1].type === result, true,
    "metadata retains exact future and error channels");
  assert.equal(rustNamedTypeCarrierValue(result).genericArguments[0].type === future, true,
    "anonymous payload is inferred only in constructor syntax");
  const forbidden = { kind: "function-pointer", args: [], result: future };
  assert.equal(rustCallableConstructionType(forbidden, fixture.context) === undefined, true,
    "constructor inference does not admit impl Trait in function-pointer signatures");
});
