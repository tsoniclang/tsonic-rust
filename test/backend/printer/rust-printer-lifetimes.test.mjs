import assert from "node:assert/strict";
import { test } from "node:test";

import { printRustSourceFile } from "../../../dist/print/source/index.js";
import { printRustType } from "../../../dist/print/source/types.js";

const namedLifetime = (name) => ({ kind: "named", name });
const lifetimeParameter = (name, outlives = []) => ({
  kind: "lifetime",
  name,
  outlives,
});
const traitReference = (path, genericArguments = [], binder) => ({
  trait: { kind: "named", path, genericArguments },
  ...(binder === undefined ? {} : { binder }),
});

test("Rust type printer preserves omitted, named, static, placeholder, and nested reference lifetimes", () => {
  assert.equal(
    printRustType({
      kind: "reference",
      mutable: false,
      lifetime: namedLifetime("a"),
      referent: {
        kind: "reference",
        mutable: true,
        lifetime: namedLifetime("b"),
        referent: { kind: "primitive", name: "i32" },
      },
    }),
    "&'a &'b mut i32",
  );
  assert.equal(
    printRustType({
      kind: "reference",
      mutable: false,
      referent: { kind: "primitive", name: "i32" },
    }),
    "&i32",
  );
  assert.equal(
    printRustType({
      kind: "reference",
      mutable: false,
      lifetime: { kind: "static" },
      referent: { kind: "str" },
    }),
    "&'static str",
  );
  assert.equal(
    printRustType({
      kind: "reference",
      mutable: true,
      lifetime: { kind: "placeholder" },
      referent: { kind: "slice", element: { kind: "primitive", name: "u8" } },
    }),
    "&'_ mut [u8]",
  );
});

test("Rust type printer preserves higher-ranked, trait-object, opaque, and associated lifetime contracts", () => {
  const bound = lifetimeParameter("value");
  const borrowedI32 = {
    kind: "reference",
    mutable: false,
    lifetime: namedLifetime("value"),
    referent: { kind: "primitive", name: "i32" },
  };
  assert.equal(
    printRustType({
      kind: "function-pointer",
      binder: [bound],
      parameters: [borrowedI32],
      result: borrowedI32,
    }),
    "for<'value> fn(&'value i32) -> &'value i32",
  );
  assert.equal(
    printRustType({
      kind: "trait-object",
      principal: traitReference(
        "crate::Lend",
        [{ kind: "type", type: borrowedI32 }],
        [bound],
      ),
      autoTraits: [traitReference("Send")],
      lifetime: { kind: "static" },
    }),
    "dyn for<'value> crate::Lend<&'value i32> + Send + 'static",
  );
  assert.equal(
    printRustType({
      kind: "impl-trait",
      bounds: [traitReference("crate::View")],
      outlives: [namedLifetime("a")],
      captures: [namedLifetime("a"), namedLifetime("b")],
    }),
    "impl crate::View + 'a + use<'a, 'b>",
  );
  assert.equal(
    printRustType({
      kind: "qualified",
      owner: { kind: "named", path: "T" },
      trait: { kind: "named", path: "crate::Family" },
      member: "Item",
      genericArguments: [{ kind: "lifetime", lifetime: namedLifetime("a") }],
    }),
    "<T as crate::Family>::Item<'a>",
  );
});

test("Rust item printer preserves mixed generic order, outlives bounds, GAT constraints, and HRTB trait bounds", () => {
  const a = namedLifetime("a");
  const b = namedLifetime("b");
  const c = namedLifetime("c");
  const source = printRustSourceFile({
    headerComment: "lifetime proof",
    items: [{
      kind: "function",
      name: "pick",
      visibility: "public",
      generics: {
        parameters: [
          lifetimeParameter("a"),
          lifetimeParameter("b", [a]),
          {
            kind: "type",
            name: "T",
            bounds: [
              { kind: "lifetime", lifetime: a },
              { kind: "maybe-sized" },
            ],
          },
          {
            kind: "const",
            name: "N",
            type: { kind: "primitive", name: "usize" },
          },
        ],
        wherePredicates: [{
          kind: "type",
          type: { kind: "named", path: "T" },
          bounds: [{
            kind: "trait-type",
            reference: traitReference(
              "crate::Lend",
              [{ kind: "lifetime", lifetime: c }],
              [lifetimeParameter("c")],
            ),
          }],
        }],
      },
      params: [{
        name: "value",
        type: {
          kind: "named",
          path: "crate::Family",
          genericArguments: [
            { kind: "lifetime", lifetime: a },
            { kind: "type", type: { kind: "named", path: "T" } },
            { kind: "const", value: { kind: "path", path: "N" } },
            {
              kind: "associated-equality",
              name: "Item",
              genericArguments: [{ kind: "lifetime", lifetime: b }],
              type: {
                kind: "reference",
                mutable: false,
                lifetime: b,
                referent: { kind: "named", path: "T" },
              },
            },
            {
              kind: "associated-bounds",
              name: "Output",
              genericArguments: [{ kind: "lifetime", lifetime: b }],
              bounds: [
                {
                  kind: "trait-type",
                  reference: traitReference(
                    "crate::Borrow",
                    [{ kind: "lifetime", lifetime: c }],
                    [lifetimeParameter("c")],
                  ),
                },
                { kind: "lifetime", lifetime: a },
              ],
            },
          ],
        },
      }],
      returnType: {
        kind: "reference",
        mutable: false,
        lifetime: a,
        referent: { kind: "named", path: "T" },
      },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "unreachable",
            message: "printer-only lifetime proof",
          },
        }],
      },
    }],
  });

  assert.match(source, /pub fn pick<'a, 'b: 'a, T: 'a \+ \?Sized, const N: usize>/u);
  assert.match(source, /crate::Family<'a, T, N, Item<'b> = &'b T, Output<'b>: for<'c> crate::Borrow<'c> \+ 'a>/u);
  assert.match(source, /-> &'a T/u);
  assert.match(source, /where\n    T: for<'c> crate::Lend<'c>,/u);
});
