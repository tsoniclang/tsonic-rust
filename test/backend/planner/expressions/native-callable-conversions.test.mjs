import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosureProducerFixture, nativeClosureProducerErrorFacts } from "../../../helpers/native-closure-producers.mjs";
import { planRustCallableInputProducer, planRustCallableConversion }
  from "../../../../dist/backend/planner/expressions/callable-conversions.js";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../../../dist/target-model/conversions/callable.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", []);
const integer = rustSourcePrimitiveTargetType("int32");

function fixture(throwing = false) {
  const current = nativeClosureProducerFixture(throwing ? { selectFacts: nativeClosureProducerErrorFacts(failure) } : {});
  const source = current.program.facts.getFact(current.node, rustTargetOperationFactKey).resultCarrier;
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
      const converted = planRustCallableConversion(conversion, current.expression, current.node, current.context);
      assert.equal(converted !== undefined, true, "physical adapter plans");
      const text = printRustExpr(converted);
      assert.doesNotMatch(text, /ConsumerFailure|TsonicError|TsonicResult|\.clone\(/u);
      assert.equal((text.match(/rt::Callable::<[^\n]+>::new/gu) ?? []).length, retained ? 1 : 0);
      assert.match(text, new RegExp(`Ok::<_, ${throwing ? "ProducerFailure" : "core::convert::Infallible"}>`, "u"));
      if (retained) assert.match(text, /rt::Callable::<\(i32,\), _>::new/u);
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
    { ...block, body: { ...block.body, innerAttrs: [{ path: "allow", args: [{ kind: "path", path: "dead_code" }] }] } },
  ]) {
    assert.equal(planRustCallableInputProducer(expression, current.source, current.context, current.node) === expression,
      true, "nonmatching producer is never structurally guessed");
  }
});

test("unresolved physical storage cannot silently select a logical ambient-error constructor", () => {
  const current = fixture();
  current.context.input.program = { ...current.program, callableValues: { ...current.program.callableValues,
    nativeStorage: { ...current.program.callableValues.nativeStorage,
      valueFor: () => ({ kind: "unresolved", reason: "test missing exact source storage" }),
    },
  } };
  assert.equal(planRustCallableInputProducer(current.expression, current.source, current.context, current.node) === undefined, true);
});
