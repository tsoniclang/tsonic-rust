import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "../../../helpers/native-closure-producers.mjs";
import { planRustCallableInputProducer, planRustCallableConversion }
  from "../../../../dist/backend/planner/expressions/callable-conversions.js";

import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../../../dist/target-model/conversions/callable.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { nativeFallibleAdapterFixture, admitNativeCallableAdapter } from "../../../helpers/physical-callable-adapters.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";
import { planRustNativeInputInvocation, planRustNativeProtocolInvocation } from "../../../../dist/backend/planner/expressions/calls/native-input.js";

const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", [], [], undefined, [], undefined, []);
const integer = rustSourcePrimitiveTargetType("int32");

for (const retained of [false, true]) {
  test(`native protocol invocation borrows its ${retained ? "owned" : "already borrowed"} exact input once`, () => {
    const current = nativeClosureProducerFixture({ source: `
      import type { int32 } from "@tsonic/core/types.js";
      export ${retained ? "async " : ""}function invoke(callback: () => int32): ${retained ? "Promise<int32>" : "int32"} {
        return callback();
      }
      export function create(): () => int32 { return (): int32 => 3; }
    ` });
    const calls = current.program.callableValues.native.calls;
    assert.equal(calls.length, 1);
    const value = { kind: "path", path: "callback" };
    const planned = planRustNativeInputInvocation(calls[0], value, [], undefined, current.context);
    assert.equal(planned !== undefined, true);
    assert.deepEqual(planned.args, [retained ? { kind: "reference", expr: value } : value]);
  });
}

function fixture(throwing = false) {
  const current = nativeClosureProducerFixture(throwing ? {
    packages: [nativeClosureProducerFailurePackage(failure)], source: `
import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 { return (): int32 => { fail(); return 3; }; }
`,
  } : {});
  const source = current.program.records.targetOperation.get(current.node).resultCarrier;
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "exact source producer plans");
  return { ...current, source, expression };
}

for (const throwing of [false, true]) {
  test(`borrowed input elides the fresh physical ${throwing ? "fallible" : "pure"} producer allocation`, () => {
    const current = fixture(throwing);
    const converted = planRustCallableInputProducer(current.expression, current.source, current.context, current.node);
    assert.equal(converted !== undefined, true);
    const text = printRustExpr(converted);
    assert.doesNotMatch(text, /Callable|::new|ConsumerFailure|TsonicError|TsonicResult/u);
    assert.match(text, new RegExp(`Ok::<_, ${throwing ? "ProducerFailure" : "core::convert::Infallible"}>`, "u"));
  });

  for (const retained of [false, true]) {
    test(`${retained ? "retained" : "borrowed"} arity adapter keeps ${throwing ? "native E" : "Infallible"} without an intermediate allocation`, () => {
      const current = fixture(throwing);
      const target = retained ? rustCallableTargetType([integer], integer) : rustCallableInputTargetType([integer], integer);
      const conversion = selectRustCallableConversion(current.source, target, () => undefined, current.program.typeDefinitions);
      assert.equal(conversion !== undefined, true);
      admitNativeCallableAdapter(current, conversion);
      const converted = planRustCallableConversion(conversion, current.expression, current.node, current.context);
      assert.equal(converted !== undefined, true, "physical adapter plans");
      const text = printRustExpr(converted);
      assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult|\.clone\(/u);
      assert.equal((text.match(/rt::Callable::<[^\n]+>::new/gu) ?? []).length, retained ? 1 : 0);
      assert.match(text, new RegExp(`Ok::<_, ${throwing ? "ProducerFailure" : "core::convert::Infallible"}>`, "u"));
      if (retained) assert.match(text, new RegExp(
        `rt::Callable::<'_, \\(i32,\\), Result<i32, ${throwing ? "ProducerFailure" : "core::convert::Infallible"}>>::new`, "u"));
    });
  }
}

test("inline elimination preserves preparation effects and refuses decorated or different constructors", () => {
  const current = fixture();
  const prepare = { kind: "expr", expr: { kind: "call", path: "prepare", args: [] } };
  const block = { kind: "block", body: { statements: [prepare, { kind: "tail", expr: current.expression }] } };
  const converted = planRustCallableInputProducer(block, current.source, current.context, current.node);
  assert.equal(converted !== undefined, true);
  assert.equal(converted.body.statements[0] === prepare, true, "preparation remains exactly once in order");
  assert.doesNotMatch(printRustExpr(converted), /::new/u);
  for (const expression of [
    { ...current.expression, method: "recursive" },
    { ...current.expression, owner: { ...current.expression.owner, path: "OtherCallable" } },
    { ...block, body: { ...block.body, innerAttrs: [{ kind: "list", path: "allow", arguments: [{ kind: "word", path: "dead_code" }] }] } },
  ]) {
    assert.equal(planRustCallableInputProducer(expression, current.source, current.context, current.node) === expression,
      true, "nonmatching producer is never structurally guessed");
  }
});

test("unresolved physical storage cannot silently select a logical ambient-error constructor", () => {
  const current = fixture();
  current.context.input.program = { ...current.program, callableValues: { ...current.program.callableValues,
    nativeStorage: { ...current.program.callableValues.nativeStorage,
      operandFor: () => ({ kind: "unresolved", reason: "test missing exact source storage" }),
    },
  } };
  assert.equal(planRustCallableInputProducer(current.expression, current.source, current.context, current.node) === undefined, true);
});

test("adapter emission requires the exact source-node callable identity", () => {
  const current = fixture();
  const foreign = rustCallableTargetType([integer], integer);
  const conversion = selectRustCallableConversion(foreign, rustCallableTargetType([integer, integer], integer),
    () => undefined, current.program.typeDefinitions);
  assert.equal(conversion !== undefined, true);
  assert.equal(current.context.emissionContext.callableAdapters.some(adapter => adapter.selection === conversion), false,
    "a foreign logical source cannot supply an admitted adapter selection");
  assert.equal(planRustCallableConversion(conversion, current.expression, current.node, current.context) === undefined, true);
});

test("fallible adapters use the same canonical native error channels as their physical signature", () => {
  const current = nativeFallibleAdapterFixture();
  const converted = current.adapt();
  assert.equal(converted !== undefined, true, "fallible adaptation plans");
  const text = printRustExpr(converted);
  assert.doesNotMatch(text, /ConsumerFailure|::from\(|\.clone\(/u);
  assert.match(text, /NativeErrors3<ProducerFailure, tsonic_rust_runtime::TsonicError, tsonic_rust_runtime::TsonicError>/u);
  assert.match(text, /checked_integer::<i32>[\s\S]+::Error1/u);
  assert.match(text, /::Error0/u);
  assert.match(text, /::Error2/u);
  assert.equal((text.match(/rt::Callable::<[^\n]+>::new/gu) ?? []).length, 1);
  const file = current.program.source.ast.getFileName(current.program.source.ast.getSourceFile(current.node));
  assert.equal(current.context.input.errorRegions.itemsFor(file).filter(item => item.name === "NativeErrors3").length, 1);
});

test("formal callable adaptation invokes the exact selected protocol rather than a runtime dictionary", () => {
  const current = nativeClosureProducerFixture({ source: `import type { int32 } from "@tsonic/core/types.js";
export function adapt(callback: () => int32): () => int32 { const local = callback; return local; }
export function create(): () => int32 { return (): int32 => { return 3; }; }
` });
  const { ast } = current.program.source;
  let local;
  const visit = node => {
    const name = ast.name(node);
    if (name !== undefined && ast.text(name) === "local" && ast.is.IsVariableDeclaration(node)) local = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  current.program.sourceFiles.forEach(visit);
  assert.equal(local !== undefined, true);
  const node = Node_Initializer(ast, local);
  const input = current.program.callableValues.native.inputs[0];
  assert.equal(input !== undefined, true);
  const conversion = selectRustCallableConversion(input.carrier, rustCallableInputTargetType([integer], integer),
    () => undefined, current.program.typeDefinitions);
  assert.equal(conversion !== undefined, true);
  admitNativeCallableAdapter(current, conversion, node);
  const converted = planRustCallableConversion(conversion, { kind: "path", path: "callback" }, node, current.context);
  assert.equal(converted !== undefined, true, "formal protocol adaptation plans");
  const text = printRustExpr(converted);
  assert.match(text, new RegExp(`as crate::index::${input.protocol.targetName}>::invoke`, "u"));
  assert.doesNotMatch(text, /Callable::|\.call\(|\.invoke\(|\.clone\(|TsonicError|ConsumerFailure/u);
  assert.equal(planRustNativeProtocolInvocation({ ...input }, { kind: "path", path: "callback" }, [], undefined, current.context) === undefined,
    true, "an equal-looking input cannot replace the selected source identity");
  assert.equal(planRustNativeProtocolInvocation(input, { kind: "path", path: "callback" }, [{ kind: "int-literal", text: "0" }], undefined,
    current.context) === undefined, true, "protocol argument arity remains exact");
});
