import assert from "node:assert/strict";
import test from "node:test";
import { rustBorrowedStringView, rustStringConcat, rustStringConcatenationParts } from "../../../dist/backend/target-ast/expressions.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";

test("native concatenation borrows exact strings and retains dynamic argument order", () => {
  const first = { kind: "call", path: "first", args: [] };
  const last = { kind: "call", path: "last", args: [] };
  const parts = rustStringConcatenationParts([
    first, { kind: "str-literal", value: "{abcdefghij}" }, last,
  ]);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].args[0].expr === first, true, "first argument identity");
  assert.equal(parts[1].value, "{abcdefghij}");
  assert.equal(parts[2].args[0].expr === last, true, "last argument identity");
});

test("native concatenation borrows literals while standalone literal results stay owned", () => {
  const literal = { kind: "string-literal", value: "abc" };
  assert.deepEqual(rustBorrowedStringView(literal), { kind: "str-literal", value: "abc" });
  assert.deepEqual(rustStringConcat([{ kind: "str-literal", value: "abc" }]), literal);
  assert.deepEqual(rustStringConcat([
    { kind: "owned-string-from-borrowed-str", expression: { kind: "str-literal", value: "ab" } },
    { kind: "str-literal", value: "c" },
  ]), literal);
});

test("native concatenation preserves literal delimiters without display formatting", () => {
  const expression = rustStringConcat([
    { kind: "str-literal", value: "{\"quoted\"}\\\n" },
    { kind: "path", path: "value" },
  ]);
  assert.equal(printRustExpr(expression), '["{\\"quoted\\"}\\\\\\n", core::convert::AsRef::<str>::as_ref(&value)].concat()');
  assert.equal(printRustExpr(rustStringConcat([
    { kind: "path", path: "seed" },
    { kind: "string-literal", value: "abcdefghij" },
  ])), '[core::convert::AsRef::<str>::as_ref(&seed), "abcdefghij"].concat()');
});
