import assert from "node:assert/strict";
import test from "node:test";
import { rustDeriveAttributes, rustHiddenAttribute, rustListAttribute, rustValueAttribute, rustWordAttribute } from "../../../dist/backend/target-ast/attributes.js";
import { printRustAttribute, printRustAttributes } from "../../../dist/print/source/attributes.js";

test("structured attributes preserve exact paths, positional/named/tuple arguments and order", () => {
  const attributes = [
    rustWordAttribute("cuda_device::kernel"),
    rustListAttribute("cuda_device::launch_bounds", [{ kind: "integer", value: 256n }]),
    rustListAttribute("cuda_device::launch_contract", [
      rustValueAttribute("domain", { kind: "integer", value: 1n }),
      rustValueAttribute("block", { kind: "tuple", elements: [256n, 1n, 1n].map(value => ({ kind: "integer", value })) }),
    ]),
  ];
  assert.equal(printRustAttributes(attributes, 0), "#[cuda_device::kernel]\n#[cuda_device::launch_bounds(256)]\n#[cuda_device::launch_contract(domain = 1 , block = (256 , 1 , 1))]\n");
  assert.equal(printRustAttribute(rustWordAttribute("no_std"), true), "#![no_std]");
  assert.equal(printRustAttribute(rustValueAttribute("doc", { kind: "string", value: 'quote"\\\n\0😀' })), '#[doc = "quote\\"\\\\\\n\\0😀"]');
});

test("generated derives and lints use the same meta model without raw attribute strings", () => {
  assert.deepEqual(rustDeriveAttributes([]), []);
  const attributes = [rustHiddenAttribute, ...rustDeriveAttributes(["Clone", "Copy"])];
  assert.equal(printRustAttributes(attributes, 1), "    #[doc(hidden)]\n    #[derive(Clone , Copy)]\n");
  const expected = rustListAttribute("expect", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "unused authored item" })]);
  assert.equal(printRustAttribute(expected), '#[expect(dead_code , reason = "unused authored item")]');
  assert.ok(Object.isFrozen(expected));
  assert.ok(Object.isFrozen(expected.tokens));
});

test("attribute macros retain arbitrary native token syntax through the same token model", () => {
  const attribute = { path: "fixture::syntax", tokens: [{ kind: "group", delimiter: "parentheses", tokens: [
    { kind: "identifier", text: "type", raw: true },
    { kind: "punctuation", text: "=", joint: true },
    { kind: "punctuation", text: ">", joint: false },
    { kind: "group", delimiter: "braces", tokens: [
      { kind: "literal", text: "9007199254740993_u64" },
      { kind: "punctuation", text: ";", joint: false },
      { kind: "literal", text: 'r##"exact\\text"##' },
    ] },
  ] }] };
  assert.equal(printRustAttribute(attribute), '#[fixture::syntax(r#type => {9007199254740993_u64 ; r##"exact\\text"##})]');
  assert.equal(printRustAttribute(attribute, true), '#![fixture::syntax(r#type => {9007199254740993_u64 ; r##"exact\\text"##})]');
});

test("generated tuple metadata retains the empty and singleton grammar", () => {
  const tuples = [[], [{ kind: "integer", value: 1n }], [
    { kind: "integer", value: 1n }, { kind: "integer", value: 2n },
  ]].map(elements => rustListAttribute("shape", [{ kind: "tuple", elements }]));
  assert.deepEqual(tuples.map(attribute => printRustAttribute(attribute)), [
    "#[shape(())]", "#[shape((1 ,))]", "#[shape((1 , 2))]",
  ]);
});
