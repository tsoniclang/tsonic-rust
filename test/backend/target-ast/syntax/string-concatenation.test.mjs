import assert from "node:assert/strict";
import test from "node:test";
import { rustStringConcat, rustStringConcatenationParts } from "../../../../dist/backend/target-ast/syntax/expressions.js";

import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("native concatenation borrows exact strings and retains dynamic argument order", () => {
  const first = { kind: "call", path: "first", args: [] };
  const last = { kind: "call", path: "last", args: [] };
  const parts = rustStringConcat([
    { kind: "value", value: first }, { kind: "literal", value: "{abcdefghij}" }, { kind: "value", value: last },
  ]).parts;
  assert.equal(parts.length, 3);
  assert.equal(parts[0] === first, true, "raw first argument identity");
  assert.equal(parts[1].value, "{abcdefghij}");
  assert.equal(parts[2] === last, true, "raw last argument identity");
  const borrowed = rustStringConcatenationParts(parts);
  assert.equal(borrowed[0].path, "core::convert::AsRef::<str>::as_ref");
  assert.equal(borrowed[0].args[0].expr === first, true, "first argument lowered once");
  assert.equal(borrowed[2].path, "core::convert::AsRef::<str>::as_ref");
  assert.equal(borrowed[2].args[0].expr === last, true, "last argument lowered once");
  const printed = printRustExpr({ kind: "string-concat", parts });
  assert.equal(printed, '[core::convert::AsRef::<str>::as_ref(&first()), "{abcdefghij}", core::convert::AsRef::<str>::as_ref(&last())].concat()');
  assert.equal(printed.match(/first\(\)/gu)?.length, 1);
  assert.equal(printed.match(/last\(\)/gu)?.length, 1);
});

test("native concatenation borrows literals while standalone literal results stay owned", () => {
  const literal = { kind: "string-literal", value: "abc" };
  assert.deepEqual(rustStringConcat([{ kind: "literal", value: "abc" }]), literal);
  assert.deepEqual(rustStringConcat([
    { kind: "literal", value: "ab" },
    { kind: "literal", value: "c" },
  ]), literal);
});

test("native concatenation preserves literal delimiters without display formatting", () => {
  const expression = rustStringConcat([
    { kind: "literal", value: "{\"quoted\"}\\\n" },
    { kind: "value", value: { kind: "path", path: "value" } },
  ]);
  assert.equal(printRustExpr(expression), '["{\\"quoted\\"}\\\\\\n", core::convert::AsRef::<str>::as_ref(&value)].concat()');
  assert.equal(printRustExpr(rustStringConcat([
    { kind: "value", value: { kind: "path", path: "seed" } },
    { kind: "literal", value: "abcdefghij" },
  ])), '[core::convert::AsRef::<str>::as_ref(&seed), "abcdefghij"].concat()');
});
