import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosureProducerFixture } from "../../../helpers/native-closure-producers.mjs";
import { analyzeRust, compileRust, rustSourceText } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { planRustCallableInputProducer, planRustCallableConversion }
  from "../../../../dist/backend/planner/expressions/callable-conversions.js";

import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType } from "../../../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../../../dist/policy/conversions/callable.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { nativeFallibleAdapterFixture } from "../../../helpers/physical-callable-adapters.mjs";
import { planRustNativeInputInvocation, planRustNativeProtocolInvocation } from "../../../../dist/backend/planner/expressions/calls/native-input.js";
import { planRustErrorJoinDeclarations } from "../../../../dist/backend/planner/program/error-regions.js";

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

// A closure passed to a callable parameter is converted at that call: borrowed (a callable input), adapted to the
// parameter's arity, or retained (stored as an rt::Callable). A throwing closure here invokes a captured native
// callable input, so its error is that input's native associated error, never the program error.
const nativeError = "<Implementation0 as crate::index::NativeCallable_[0-9a-f]+>::InvocationError";
const programs = {
  borrowed: "export function invoke(callback: () => int32): int32 { return callback(); }",
  arity: "export function invoke(callback: (value: int32) => int32): int32 { return callback(1); }",
  retained: "export function keep(callback: (value: int32) => int32): (value: int32) => int32 { return callback; }",
};
function compiledRun(form, throwing) {
  const call = form === "retained" ? "keep" : "invoke";
  const result = form === "retained" ? "(value: int32) => int32" : "int32";
  const { result: compiled } = compileRust({ files: { "index.ts": `import type { int32 } from "@tsonic/core/types.js";
${programs[form]}
export function run(${throwing ? "source: () => int32" : ""}): ${result} { return ${call}((): int32 => ${throwing ? "source() + 3" : "3"}); }
` } });
  assert.deepEqual(compiled.diagnostics, []);
  const run = rustSourceText(compiled).match(/pub fn run[\s\S]*?\n\}\n/u)?.[0];
  assert.equal(run !== undefined, true, "the converting caller is emitted");
  return run;
}
const okType = throwing => throwing ? `Ok::<\\s*_,\\s*${nativeError},?\\s*>` : "Ok::<_, core::convert::Infallible>";

for (const throwing of [false, true]) {
  test(`borrowed input elides the fresh physical ${throwing ? "fallible" : "pure"} producer allocation`, () => {
    const text = compiledRun("borrowed", throwing);
    assert.doesNotMatch(text, /Callable::|::new|ConsumerFailure|TsonicError|TsonicResult/u);
    assert.match(text, new RegExp(okType(throwing), "u"));
  });

  for (const retained of [false, true]) {
    test(`${retained ? "retained" : "borrowed"} arity adapter keeps ${throwing ? "native E" : "Infallible"} without an intermediate allocation`, () => {
      const text = compiledRun(retained ? "retained" : "arity", throwing);
      assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult|\.clone\(/u);
      assert.equal((text.match(/rt::Callable::<[^\n]+>::new/gu) ?? []).length, retained ? 1 : 0);
      assert.match(text, new RegExp(okType(throwing), "u"));
      // A returned retained callable owns its environment, so its construction lifetime is 'static here.
      if (retained) assert.match(text, new RegExp(
        `rt::Callable::<'(?:_|static), \\(i32,\\), Result<i32, ${throwing ? nativeError : "core::convert::Infallible"}>>::new`, "u"));
    });
  }
}

// Planner-level cases plan against the sealed records of a real program that demands the callable input.
function fixture() {
  const current = nativeClosureProducerFixture({ source: `import type { int32 } from "@tsonic/core/types.js";
${programs.borrowed}
export function run(): int32 { return invoke((): int32 => 3); }
` });
  const source = current.program.records.targetOperation.get(current.node).resultCarrier;
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "exact source producer plans");
  return { ...current, source, expression };
}

// F6: the inline producer decision is sealed by analysis (callableOperand.inline); the planner never inspects the
// shape of a generated expression to eliminate an allocation, so every given expression yields the same producer.
test("inline producers are planned from the sealed operand record, never from the shape of a generated expression", () => {
  const current = fixture();
  // Hygienic argument names advance with each planning; the producer shape is compared without the suffix.
  const producer = expression => printRustExpr(planRustCallableInputProducer({ stage: "source", expression, node: current.node },
    current.source, current.context, current.node).expression)
    .replace(/_callable_arguments_\d+/gu, "_callable_arguments");
  const planned = producer(current.expression);
  assert.doesNotMatch(planned, /::new/u);
  const prepare = { kind: "expr", expr: { kind: "call", path: "prepare", args: [] } };
  const block = { kind: "block", body: { statements: [prepare, { kind: "tail", expr: current.expression }] } };
  for (const expression of [
    block,
    { ...current.expression, method: "recursive" },
    { ...block, body: { ...block.body, innerAttrs: [{ kind: "list", path: "allow", arguments: [{ kind: "word", path: "dead_code" }] }] } },
  ]) {
    assert.equal(producer(expression), planned,
      "the producer comes from its sealed record, not from structural guessing");
  }
});

test("unresolved physical storage cannot silently select a logical ambient-error constructor", () => {
  const current = fixture();
  // Unresolved physical storage leaves the operand unsealed; the planner refuses instead of choosing a constructor.
  const records = createRustRecordFixture({ callableOperand: { get: () => undefined } }, current.program.records);
  const context = { ...current.context, input: { ...current.context.input, program: { ...current.context.input.program, records } } };
  assert.throws(() => planRustCallableInputProducer({ stage: "source", expression: current.expression, node: current.node }, current.source, context, current.node),
    failure => failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      failure.message === "An admitted callable input requires its exact physical source operand.");
});

test("adapter emission requires the exact source-node callable identity", () => {
  const current = fixture();
  const foreign = rustCallableTargetType([integer], integer);
  const conversion = selectRustCallableConversion(foreign, rustCallableTargetType([integer, integer], integer),
    () => undefined, current.program.typeDefinitions);
  assert.equal(conversion !== undefined, true);
  assert.throws(() => planRustCallableConversion(conversion, current.expression, current.node, current.context),
    failure => failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      failure.message === "An admitted callable adapter requires its exact physical conversion contract.");
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
  const file = current.program.source.ast.getSourceFile(current.node);
  assert.equal(planRustErrorJoinDeclarations(file, current.context.input).filter(item => item.name === "NativeErrors3").length, 1);
});

test("formal callable adaptation invokes the exact selected protocol rather than a runtime dictionary", () => {
  // The callable input is adapted to a callable of another arity where the program demands it.
  const source = `import type { int32 } from "@tsonic/core/types.js";
export function adapt(callback: () => int32): int32 { const local: (value: int32) => int32 = callback; return local(1); }
`;
  const { result } = compileRust({ files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  const text = rustSourceText(result).match(/pub fn adapt[\s\S]*?\n\}\n/u)?.[0] ?? "";
  assert.match(text, /as crate::index::NativeCallable_[0-9a-f]+>::invoke/u);
  assert.doesNotMatch(text, /Callable::|\.call\(|\.clone\(|TsonicError|ConsumerFailure/u);
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const input = program.callableValues.native.inputs[0];
  assert.equal(input !== undefined, true);
  const context = rustSourceFilePlanContext(program, input.subject.node);
  assert.equal(planRustNativeProtocolInvocation({ ...input }, { kind: "path", path: "callback" }, [], undefined, context) === undefined,
    true, "an equal-looking input cannot replace the selected source identity");
  assert.equal(planRustNativeProtocolInvocation(input, { kind: "path", path: "callback" }, [{ kind: "int-literal", text: "0" }], undefined,
    context) === undefined, true, "protocol argument arity remains exact");
});
