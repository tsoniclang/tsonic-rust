import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosureProducerFixture, printNativeClosureProducer, planNativeClosureProducer, nativeClosureProducerFailurePackage }
  from "../../../helpers/native-closure-producers.mjs";
import { nativeNodes, nativeCalls, assertNoNativeCalls, nativeType } from "../../../helpers/native-ast.mjs";

import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../../dist/target-model/types/carriers/native.js";
import { printRustType } from "../../../../dist/print/source/types.js";


import { rustSourcePrimitiveTargetType, rustClosureTargetType, rustCallableInputProtocol, rustCallableInputTargetType }
  from "../../../../dist/target-model/types/index.js";
import { rustGenericCallableValue } from "../../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallableConstructionType } from "../../../../dist/backend/planner/expressions/fundamentals.js";
import { rustNativeCompletionFutureType } from "../../../../dist/target-model/types/callable-completions.js";
import { rustTypeGenericArguments } from "../../../../dist/target-model/types/generic-arguments.js";
import { rustJsValueTargetType } from "../../../../dist/target-model/types/carriers/js.js";

const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", [], [], undefined, [], undefined, []);

function producerCarrierRecords(carrier) {
  return (records, producer) => ({ ...records,
    targetOperation: { get: node => node === producer
      ? { ...records.targetOperation.get(node), resultCarrier: carrier } : records.targetOperation.get(node) },
    runtimeCarrier: { get: node => node === producer ? { carrier } : records.runtimeCarrier.get(node) },
  });
}

test("pure closure construction owns Infallible instead of inheriting the consumer's error", () => {
  const fixture = nativeClosureProducerFixture();
  const expression = planNativeClosureProducer(fixture);
  assert.equal(expression.kind, "associated-call");
  assert.equal(expression.method, "new");
  assert.equal(expression.owner.path, "rt::Callable");
  const types = expression.owner.genericArguments.filter(argument => argument.kind === "type").map(argument => argument.type);
  assert.deepEqual(types[0], nativeType("()"));
  assert.equal(types[1].path, "Result");
  assert.deepEqual(types[1].genericArguments.map(argument => argument.type), [nativeType("i32"), { kind: "named", path: "core::convert::Infallible" }]);
  const completed = nativeCalls(expression, "Ok");
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].args, [{ kind: "int-literal", text: "3" }]);
  assertNoNativeCalls(expression, ["clone", "Box::new"], "pure construction introduces no extra owner or clone");
  assert.equal(nativeNodes(expression, node => node.kind === "named" && ["ConsumerFailure", "rt::TsonicError", "rt::TsonicResult"].includes(node.path)).length, 0);
  assert.equal(fixture.bodyContexts.length, 1);
  assert.equal(fixture.bodyContexts[0].fallibleBoundary === undefined, true, "pure body has no invented error region");
});

test("fallible closure construction and body retain the producer's exact native error", () => {
  const fixture = nativeClosureProducerFixture({ packages: [nativeClosureProducerFailurePackage(failure)], source: `
import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 {
  return (): int32 => { fail(); return 3; };
}
` });
  const effects = fixture.original.records.errorEffects.get(fixture.node);
  assert.equal(effects.nativeErrors.length, 1, "one checked native producer error");
  assert.deepEqual(effects.nativeErrors[0].errorType, failure,
    "the checked provider supplies the exact producer error before sealing");
  const expression = planNativeClosureProducer(fixture);
  assert.equal(expression.kind, "associated-call");
  assert.equal(expression.method, "new");
  assert.equal(expression.owner.path, "rt::Callable");
  const results = nativeNodes(expression.owner, node => node.kind === "named" && node.path === "Result");
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].genericArguments.map(argument => argument.type), [nativeType("i32"), { kind: "named", path: "ProducerFailure", identity: "fixture:ProducerFailure" }]);
  const completed = nativeCalls(expression, "Ok");
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].args, [{ kind: "int-literal", text: "3" }]);
  assert.equal(printRustType(fixture.bodyContexts[0].fallibleBoundary.errorType), "ProducerFailure");
  assertNoNativeCalls(expression, ["clone", "Box::new"], "producer errors add no wrapper or clone");
  assert.equal(nativeNodes(expression, node => node.kind === "named" && ["ConsumerFailure", "rt::TsonicError", "rt::TsonicResult"].includes(node.path)).length, 0);
});

for (const pending of [false, true]) {
  for (const throwing of [false, true]) {
    test(`JS Promise creation separates pure invocation from ${pending ? "pending" : "settled"} ${throwing ? "fallible" : "pure"} body`, () => {
      const fixture = nativeClosureProducerFixture({ asynchronous: true, surfaces: ["js"],
        ...(throwing ? { packages: [nativeClosureProducerFailurePackage(rustJsValueTargetType())], source: `
import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): (${pending ? "pending: Promise<void>" : ""}) => Promise<int32> {
  return async (${pending ? "pending: Promise<void>" : ""}): Promise<int32> => { ${pending ? "await pending;" : ""} fail(); return 3; };
}
` } : pending ? { source: `
import type { int32 } from "@tsonic/core/types.js";
export function create(): (pending: Promise<void>) => Promise<int32> {
  return async (pending: Promise<void>): Promise<int32> => { await pending; return 3; };
}
` } : {}),
      });
      const expression = planNativeClosureProducer(fixture);
      const error = "js_abi::JsValue";
      const completed = nativeCalls(expression, "Ok");
      assert.equal(completed.filter(call => call.genericArguments?.[1].type.path === "core::convert::Infallible" &&
        call.args[0]?.kind !== "int-literal").length, 1, "constructing the Promise is infallible regardless of body errors");
      assert.equal(fixture.bodyContexts[0].asyncContext, pending,
        "only a real selected pending body enters an async native context");
      assert.equal(fixture.bodyContexts[0].fallibleBoundary === undefined, !throwing);
      assertNoNativeCalls(expression, ["clone", "Box::new"], "no additional Promise owner");
      assert.equal(nativeNodes(expression, node => node.kind === "named" && ["ConsumerFailure", "rt::TsonicError", "rt::TsonicResult"].includes(node.path)).length, 0);
      const constructors = nativeNodes(expression, node => node.kind === "call" &&
        node.path === `js_abi::JsPromise::${pending ? throwing ? "from_fallible_factory" : "from_infallible_factory"
          : throwing ? "from_result" : "resolved"}`);
      assert.equal(constructors.length, 1, "exactly one constructor agrees with the completed lowering");
      const promiseTypes = nativeNodes(expression, node => node.kind === "named" && node.path === "js_abi::JsPromise");
      assert.equal(promiseTypes.length, 1);
      assert.equal(promiseTypes[0].genericArguments.length, 1, "the concrete JS object carries its native payload only");
      assert.deepEqual(promiseTypes[0].genericArguments[0].type, nativeType("i32"));
      const body = constructors[0].args[0];
      if (pending) {
        assert.equal(body.kind, "closure-block");
        assert.equal(body.async, true);
        assert.equal(body.move, true);
        assert.deepEqual(body.params, []);
      } else {
        assert.equal(nativeNodes(expression, node => node.kind === "call" && /from_\w+_factory/u.test(node.path)).length, 0,
          "a settled copied result has no invented pending factory");
      }
      if (throwing) {
        const completedBody = nativeCalls(body, "Ok");
        assert.equal(completedBody.length, 1);
        assert.equal(completedBody[0].genericArguments[1].type.path, error);
        assert.deepEqual(completedBody[0].args, [{ kind: "int-literal", text: "3" }]);
      } else {
        if (pending) assert.deepEqual(body.body.statements, [{ kind: "tail", expr: { kind: "int-literal", text: "3" } }]);
        else assert.deepEqual(body, { kind: "int-literal", text: "3" });
        assert.equal(nativeCalls(body, "Ok").length, 0, "an infallible body needs no synthetic Result wrapper");
      }
    });
  }
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
  assert.equal(fixture.program.callableValues.nativeProducers.physicalFor(fixture.node, carrier) !== undefined, true,
    "the borrowed fixture carrier has its own exact pre-seal producer correspondence");
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
  const fixture = nativeClosureProducerFixture({ packages: [nativeClosureProducerFailurePackage(failure)], source: `
import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 {
  const callback: () => int32 = (): int32 => { fail(); return callback(); };
  return callback;
}
` });
  const capture = fixture.program.records.closureCapture.get(fixture.node);
  assert.equal(capture.recursiveDeclaration !== undefined, true);
  const expression = planNativeClosureProducer(fixture);
  assert.equal(expression.kind, "associated-call");
  assert.equal(expression.method, "recursive");
  assert.equal(expression.owner.path, "rt::Callable");
  const results = nativeNodes(expression.owner, node => node.kind === "named" && node.path === "Result");
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].genericArguments[0].type, nativeType("i32"));
  assert.equal(results[0].genericArguments[1].type.path, "ProducerFailure");
  assert.equal(nativeNodes(expression, node => node.kind === "named" && ["ConsumerFailure", "rt::TsonicError", "rt::TsonicResult"].includes(node.path)).length, 0);
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
    selectEmissionContexts: (contexts, producer) => ({ ...contexts,
      bodyContextFor: (use, node) => {
        const selected = contexts.bodyContextFor(use, node);
        return node !== producer || selected === undefined ? selected : { ...selected, error: { kind: "none" } };
      } }),
  });
  assert.equal(fixture.plan() === undefined, true, "missing error fact rejects");
  assert.equal(fixture.bodyContexts.length, 0, "invalid producer never plans its body");
  assert.equal(fixture.context.diagnostics.length, 1);
  assert.match(fixture.context.diagnostics[0].message, /finalized native error region/u);
});

for (const method of ["errorFor", "physicalFor"]) {
  test(`closure construction rejects missing producer ${method} evidence`, () => {
    const fixture = nativeClosureProducerFixture({
      ...(method === "errorFor" ? { selectRecords: producerCarrierRecords(rustCallableInputTargetType([], rustSourcePrimitiveTargetType("int32"))) } : {}),
      selectProducers: plan => ({ ...plan, [method]: () => undefined }),
    });
    assert.equal(fixture.plan() === undefined, true, method);
    assert.equal(fixture.bodyContexts.length, 0);
    assert.equal(fixture.context.diagnostics.length, 1);
  });
}

test("closure constructors infer anonymous native payloads without changing their selected carrier", () => {
  const fixture = nativeClosureProducerFixture();
  const integer = rustSourcePrimitiveTargetType("int32");
  const future = rustNativeCompletionFutureType({ identity: "fixture:future", output: integer, error: failure, captures: [] });
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future, failure]), [], undefined, [], undefined, []);
  const callable = rustNamedTargetType("rust.runtime.Callable", "rt::Callable",
    rustTypeGenericArguments([{ kind: "tuple", elements: [integer] }, result]), [], undefined, [], undefined, []);
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
