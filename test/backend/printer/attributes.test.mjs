import assert from "node:assert/strict";
import test from "node:test";
import { rustDeriveAttributes, rustHiddenAttribute, rustListAttribute, rustValueAttribute, rustWordAttribute } from "../../../dist/backend/target-ast/attributes.js";
import { printRustAttribute, printRustAttributes } from "../../../dist/print/source/attributes.js";

test("generated layout and naming attributes preserve structured arguments and order", () => {
  const attributes = [
    rustListAttribute("repr", [rustWordAttribute("C")]),
    rustListAttribute("repr", [rustListAttribute("align", [{ kind: "integer", value: 256n }])]),
    rustListAttribute("allow", [rustWordAttribute("non_snake_case"), rustWordAttribute("clippy::type_complexity")]),
  ];
  assert.equal(printRustAttributes(attributes, 0), "#[repr(C)]\n#[repr(align(256))]\n#[allow(non_snake_case, clippy::type_complexity)]\n");
  assert.equal(printRustAttribute(rustWordAttribute("no_std"), true), "#![no_std]");
  assert.equal(printRustAttribute(rustValueAttribute("doc", { kind: "string", value: 'quote"\\\n\0😀' })), '#[doc = "quote\\"\\\\\\n\\0😀"]');
  assert.equal(printRustAttribute(rustListAttribute("integer", [{ kind: "integer", value: 9007199254740993n }])), "#[integer(9007199254740993)]");
  assert.equal(printRustAttribute(rustValueAttribute("enabled", { kind: "boolean", value: false })), "#[enabled = false]");
});

test("generated derives and lints use the same meta model without raw attribute strings", () => {
  assert.deepEqual(rustDeriveAttributes([]), []);
  const attributes = [rustHiddenAttribute, ...rustDeriveAttributes(["Clone", "Copy"])];
  assert.equal(printRustAttributes(attributes, 1), "    #[doc(hidden)]\n    #[derive(Clone, Copy)]\n");
  const expected = rustListAttribute("expect", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "unused authored item" })]);
  assert.equal(printRustAttribute(expected), '#[expect(dead_code, reason = "unused authored item")]');
  assert.ok(Object.isFrozen(expected));
  assert.ok(Object.isFrozen(expected.arguments));
});
