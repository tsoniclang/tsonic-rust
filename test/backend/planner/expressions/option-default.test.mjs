import assert from "node:assert/strict";
import test from "node:test";
import { rustOptionDefaultValue } from "../../../../dist/backend/planner/expressions/option-default.js";

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
