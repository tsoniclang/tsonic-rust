import assert from "node:assert/strict";
import { test } from "node:test";

import { printRustSourceFile } from "../../../dist/print/source/index.js";
import { printRustConstExpression } from "../../../dist/print/source/types.js";

const emptyGenerics = Object.freeze({ parameters: Object.freeze([]), wherePredicates: Object.freeze([]) });

test("const paths retain exact generic arguments with a turbofish", () => {
  assert.equal(printRustConstExpression({
    kind: "path",
    path: "limit",
    genericArguments: [{
      kind: "const",
      expression: { kind: "integer", value: 3n },
    }],
  }), "limit::<3>");
});

test("tuple-struct where clauses follow fields and terminate without a trailing comma", () => {
  const source = printRustSourceFile({
    headerComment: "proof",
    items: [{
      kind: "struct",
      name: "Wrapper",
      visibility: "public",
      generics: {
        parameters: [{ kind: "type", name: "T", bounds: [] }],
        wherePredicates: [{
          kind: "type",
          type: { kind: "named", path: "T" },
          bounds: [{ kind: "trait", trait: { kind: "named", path: "Copy" } }],
        }],
      },
      fields: {
        kind: "tuple",
        fields: [{ visibility: "private", type: { kind: "named", path: "T" } }],
      },
    }],
  });

  assert.match(source, /pub struct Wrapper<T>\(T\)\nwhere\n {4}T: Copy;/u);
  assert.doesNotMatch(source, /T: Copy,;/u);
});

test("Rust character literals reject UTF-16 surrogate code units", () => {
  assert.throws(
    () => printRustConstExpression({ kind: "character", value: "\ud800" }),
    /exactly one Unicode scalar value/u,
  );
  assert.throws(() => printRustSourceFile({
    headerComment: "proof",
    items: [{
      kind: "function",
      name: "character",
      visibility: "public",
      generics: emptyGenerics,
      params: [],
      body: {
        statements: [{ kind: "tail", expr: { kind: "char-literal", value: "\ud800" } }],
      },
    }],
  }), /exactly one Unicode scalar value/u);
});

test("Rust target AST rejects an empty tuple type in favor of canonical unit", () => {
  assert.throws(
    () => printRustSourceFile({
      headerComment: "proof",
      items: [{
        kind: "type-alias",
        name: "Empty",
        visibility: "private",
        generics: emptyGenerics,
        target: { kind: "tuple", elements: [] },
      }],
    }),
    /empty tuple type instead of the canonical unit type/u,
  );
});

test("the target model rejects malformed generic and type combinations", () => {
  const functionItem = {
    kind: "function",
    name: "proof",
    visibility: "public",
    params: [],
    body: { statements: [] },
  };
  const printItem = (item) => printRustSourceFile({ headerComment: "proof", items: [item] });

  assert.throws(() => printItem({
    ...functionItem,
    generics: {
      parameters: [
        { kind: "type", name: "T", bounds: [] },
        { kind: "lifetime", name: "a", bounds: [] },
      ],
      wherePredicates: [],
    },
  }), /lifetime parameter 'a' after a type or const parameter/u);

  assert.throws(() => printItem({
    ...functionItem,
    generics: emptyGenerics,
    returnType: { kind: "trait-object", bounds: [] },
  }), /empty trait-object bound set/u);

  assert.throws(() => printItem({
    ...functionItem,
    generics: emptyGenerics,
    returnType: {
      kind: "opaque",
      bounds: [{ kind: "trait", trait: { kind: "named", path: "Iterator" } }],
    },
  }), /exactly one precise-capture bound/u);

  assert.throws(() => printItem({
    ...functionItem,
    generics: emptyGenerics,
    returnType: {
      kind: "opaque",
      bounds: [
        { kind: "trait", trait: { kind: "named", path: "Iterator" } },
        {
          kind: "precise-capture",
          captures: [
            { kind: "type", type: { kind: "named", path: "T" } },
            { kind: "lifetime", lifetime: { kind: "named", name: "a" } },
          ],
        },
      ],
    },
  }), /invalid precise lifetime capture/u);

  assert.throws(() => printItem({
    ...functionItem,
    generics: emptyGenerics,
    returnType: {
      kind: "function-pointer",
      parameters: [{ kind: "primitive", name: "i32" }],
      result: { kind: "unit" },
      variadic: true,
    },
  }), /variadic function pointer without a non-Rust ABI/u);

  assert.throws(() => printItem({
    kind: "enum",
    name: "Result",
    visibility: "public",
    generics: emptyGenerics,
    variants: [{
      name: "Value",
      fields: {
        kind: "named",
        fields: [{
          name: "value",
          visibility: "public",
          type: { kind: "primitive", name: "i32" },
        }],
      },
    }],
  }), /enum variant 'Result::Value' field 0 cannot declare visibility/u);
});

test("opaque types print one explicit precise-capture contract including the empty set", () => {
  const source = printRustSourceFile({
    headerComment: "proof",
    items: [{
      kind: "function",
      name: "rows",
      visibility: "public",
      generics: emptyGenerics,
      params: [],
      returnType: {
        kind: "opaque",
        bounds: [
          { kind: "trait", trait: { kind: "named", path: "Iterator" } },
          { kind: "precise-capture", captures: [] },
        ],
      },
      body: { statements: [] },
    }],
  });

  assert.match(source, /-> impl Iterator \+ use<>/u);
});

test("argument-position opaque types reject return-only precise captures", () => {
  const functionItem = {
    kind: "function",
    name: "consume",
    visibility: "public",
    generics: emptyGenerics,
    params: [{
      name: "value",
      type: {
        kind: "opaque",
        bounds: [{ kind: "trait", trait: { kind: "named", path: "Iterator" } }],
      },
    }],
    body: { statements: [] },
  };

  const source = printRustSourceFile({ headerComment: "proof", items: [functionItem] });
  assert.match(source, /value: impl Iterator/u);

  assert.throws(() => printRustSourceFile({
    headerComment: "proof",
    items: [{
      ...functionItem,
      params: [{
        name: "value",
        type: {
          kind: "opaque",
          bounds: [
            { kind: "trait", trait: { kind: "named", path: "Iterator" } },
            { kind: "precise-capture", captures: [] },
          ],
        },
      }],
    }],
  }), /precise-capture bound on an argument-position opaque type/u);
});
