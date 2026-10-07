import assert from "node:assert/strict";
import test from "node:test";
import { rustOptionDefaultValue } from "../../../../dist/backend/planner/expressions/option-default.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { fakeAstReader, fakeSourceFile } from "../../../helpers/fake-compile-input.mjs";

const option = { kind: "path", path: "input" };
const scalar = { kind: "int-literal", text: "11" };
const carrier = { kind: "source-primitive", name: "int32" };

test("constant native defaults and nested tuples do not manufacture a lazy closure", () => {
  for (const fallback of [scalar, { kind: "char-literal", value: "a" },
    { kind: "str-literal", value: "text" }, { kind: "tuple-literal", elements: [] },
    { kind: "tuple-literal", elements: [scalar, { kind: "tuple-literal", elements: [scalar] }] }]) {
    const selected = rustOptionDefaultValue(option, fallback, carrier, {});
    assert.equal(selected.method, "unwrap_or", fallback.kind);
    assert.equal(selected.receiver === option, true, fallback.kind);
    assert.equal(selected.args[0] === fallback, true, fallback.kind);
  }
});

test("effectful or allocating defaults remain lazy, including inside tuples", () => {
  for (const effect of [{ kind: "call", path: "next", args: [] },
    { kind: "string-literal", value: "owned" }, { kind: "vec-literal", elements: [scalar] }]) {
    for (const fallback of [effect, { kind: "tuple-literal", elements: [scalar, effect] }]) {
      const selected = rustOptionDefaultValue(option, fallback, carrier, {});
      assert.equal(selected.method, "unwrap_or_else", effect.kind);
      assert.equal(selected.args[0].kind, "closure", effect.kind);
      assert.equal(selected.args[0].body === fallback, true, effect.kind);
    }
  }
});

test("fallible defaults remain lazy in the owning completion region without an infallible closure", () => {
  const context = { syntheticNames: createRustSyntheticNameState(fakeAstReader(), fakeSourceFile(), []) };
  const effect = { kind: "try", expr: { kind: "call", path: "supply", args: [] } };
  for (const fallback of [effect, { kind: "tuple-literal", elements: [scalar, effect] },
    { kind: "return-expression", expr: scalar }]) {
    const selected = rustOptionDefaultValue(option, fallback, carrier, context);
    assert.equal(selected.kind, "match", fallback.kind);
    assert.equal(selected.expression === option, true, "one evaluation of optional input");
    assert.equal(selected.arms[1].pattern.path, "None");
    assert.equal(selected.arms[1].expression === fallback, true, "only the absent arm evaluates or exits");
    assert.equal(selected.arms[0].pattern.path, "Some");
    assert.equal(selected.arms[0].expression.kind, "path");
  }
  const nested = { kind: "closure", params: [], body: effect };
  const selected = rustOptionDefaultValue(option, nested, carrier, context);
  assert.equal(selected.method, "unwrap_or_else", "a returned closure owns its own fallible execution");
});
