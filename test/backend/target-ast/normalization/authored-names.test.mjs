import assert from "node:assert/strict";
import test from "node:test";
import { rustNameNeedsStyleAllowance } from "../../../../dist/backend/target-ast/normalization/authored-names.js";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { rustLintAttributes } from "../../../../dist/backend/target-ast/normalization/lint-policy.js";
import { rustListAttribute, rustWordAttribute } from "../../../../dist/backend/target-ast/attributes.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";
import { printRustSourceFile } from "../../../../dist/print/source/items.js";

test("native naming rules preserve Unicode, raw spellings and unmodified conforming names", () => {
  for (const [style, accepted, rejected] of [
    ["snake", ["value", "r#type", "__value__", "foo_1", "世界", "δ", "ǆ"], ["fooBar", "foo__bar", "Σ", "ǅ", "İ"]],
    ["camel", ["Value", "__Value__", "世界", "ǅ", "世界_5", "𝔸"], ["value", "foo_bar", "Value__More", "Value_More", "Ǆ"]],
    ["upper", ["VALUE", "__VALUE__", "世界", "Σ", "𝔸"], ["value", "moduleValue", "ß", "ǅ"]],
  ]) {
    for (const name of accepted) assert.equal(rustNameNeedsStyleAllowance(name, style), false, `${style}: ${name}`);
    for (const name of rejected) assert.equal(rustNameNeedsStyleAllowance(name, style), true, `${style}: ${name}`);
  }
});

const scalar = { kind: "primitive", name: "i32" };
const body = { statements: [{ kind: "tail", expr: { kind: "int-literal", text: "1" } }] };
const callable = { kind: "function", name: "value", visibility: "public", generics: emptyRustGenerics,
  params: [], returnType: scalar, body };
const file = items => ({ headerComment: "Naming proof", items });

test("name allowances belong only to nonconforming declaration scopes", () => {
  const normalized = finalizeRustSourceStyle(file([
    { kind: "struct", name: "http_response", visibility: "public", generics: emptyRustGenerics,
      fields: [{ name: "URLValue", visibility: "public", type: scalar }, { name: "value", visibility: "public", type: scalar }] },
    { kind: "enum", name: "Status", visibility: "public", generics: emptyRustGenerics,
      variants: [{ name: "inProgress" }, { name: "Complete" }] },
    { ...callable, name: "makeValue" }, callable,
    { kind: "mod-decl", name: "MixedCase", visibility: "public", body: file([callable]) },
    { kind: "const", name: "moduleValue", visibility: "public", type: scalar, value: { kind: "int-literal", text: "1" } },
  ]));
  const [record, enumeration, mixed, plain, module, constant] = normalized.items;
  assert.deepEqual(record.attrs, [rustLintAttributes.nonCamelCaseType]);
  assert.deepEqual(record.fields[0].attrs, [rustLintAttributes.nonSnakeCaseName]);
  assert.equal(record.fields[1].attrs, undefined);
  assert.equal(enumeration.attrs, undefined);
  assert.deepEqual(enumeration.variants[0].attrs, [rustLintAttributes.nonCamelCaseType]);
  assert.equal(enumeration.variants[1].attrs, undefined);
  assert.deepEqual(mixed.attrs, [rustLintAttributes.nonSnakeCaseName]);
  assert.equal(plain.attrs, undefined);
  assert.deepEqual(module.attrs, [rustLintAttributes.nonSnakeCaseName]);
  assert.equal(module.body.items[0].attrs, undefined);
  assert.deepEqual(constant.attrs, [rustLintAttributes.nonUpperCaseGlobal]);
  assert.equal(normalized.innerAttrs, undefined);
  assert.deepEqual(finalizeRustSourceStyle(normalized), normalized);
});

test("native C representation and trait implementation exemptions retain their compiler ownership", () => {
  const repr = rustListAttribute("repr", [rustWordAttribute("C")]);
  const declaration = { kind: "struct", name: "native_record", visibility: "public", generics: emptyRustGenerics,
    attrs: [repr], fields: [] };
  const normalized = finalizeRustSourceStyle(file([
    declaration,
    { kind: "trait", name: "Contract", visibility: "public", generics: emptyRustGenerics,
      members: [{ kind: "type", name: "value_type", bounds: [] }, { ...callable, name: "makeValue", body: undefined }] },
    { kind: "impl", target: { kind: "named", path: "native_record" }, trait: { kind: "named", path: "Contract" },
      generics: emptyRustGenerics, members: [{ kind: "type", name: "value_type", type: scalar }, { ...callable, name: "makeValue" }] },
  ]));
  assert.deepEqual(normalized.items[0].attrs, [repr]);
  assert.deepEqual(normalized.items[1].members[0].attrs, [rustLintAttributes.nonCamelCaseType]);
  assert.deepEqual(normalized.items[1].members[1].attrs, [rustLintAttributes.nonSnakeCaseName]);
  assert.equal(normalized.items[2].members[0].attrs, undefined);
  assert.equal(normalized.items[2].members[1].attrs, undefined);
});

test("generic names, parameters and nested binding names are retained without runtime wrappers", () => {
  const generic = { parameters: [{ kind: "type", name: "valueType", bounds: [] }], wherePredicates: [] };
  const parameter = { pattern: { kind: "binding", name: "inputValue" }, type: { kind: "named", path: "valueType" } };
  const statements = [
    { kind: "let", pattern: { kind: "binding", name: "localValue", mutable: false }, type: scalar, init: { kind: "int-literal", text: "1" } },
    { kind: "let", pattern: { kind: "binding", name: "callback", mutable: false }, init: { kind: "closure", params: [{ pattern: { kind: "binding", name: "nextValue" } }],
      body: { kind: "path", path: "nextValue" } } },
    { kind: "tail", expr: { kind: "path", path: "inputValue" } },
  ];
  const model = finalizeRustSourceStyle(file([{ ...callable, generics: generic, params: [parameter],
    returnType: parameter.type, body: { statements } }]));
  const fn = model.items[0];
  assert.deepEqual(fn.params, [parameter]);
  assert.deepEqual(fn.generics, generic);
  assert.ok(fn.attrs.includes(rustLintAttributes.nonCamelCaseType));
  assert.ok(fn.attrs.includes(rustLintAttributes.nonSnakeCaseName));
  assert.ok(fn.body.innerAttrs.includes(rustLintAttributes.nonSnakeCaseName));
  assert.deepEqual(fn.body.statements.map(statement => statement.kind), statements.map(statement => statement.kind));
  assert.equal(fn.body.statements[0].pattern.name, "localValue");
  assert.equal(fn.body.statements[1].init.params[0].pattern.name, "nextValue");
  assert.deepEqual(finalizeRustSourceStyle(model), model);
  const printed = printRustSourceFile(model);
  assert.match(printed, /fn value<valueType>\(inputValue: valueType\)/u);
  assert.match(printed, /let localValue: i32 = 1;/u);
  assert.doesNotMatch(printed, /\b(?:local_value|next_value|input_value)\b/u);
});

test("local function and implementation bodies use their own existing naming scopes", () => {
  const localBody = { statements: [
    { kind: "let", pattern: { kind: "binding", name: "localValue", mutable: false }, init: { kind: "int-literal", text: "1" } },
    { kind: "tail", expr: { kind: "path", path: "localValue" } },
  ] };
  const inner = { ...callable, name: "localFunction", visibility: "private", body: localBody };
  const implementation = { kind: "impl", target: { kind: "named", path: "Local" },
    generics: emptyRustGenerics, members: [{ ...callable, name: "readValue", body: localBody }] };
  const statement = item => ({ kind: "item", item });
  const input = file([{ ...callable, body: { statements: [
    statement(inner),
    statement({ kind: "struct", name: "Local", visibility: "private", generics: emptyRustGenerics, fields: [] }),
    statement(implementation),
    { kind: "tail", expr: { kind: "call", callee: { kind: "path", path: "localFunction" }, args: [] } },
  ] } }]);
  const model = finalizeRustSourceStyle(input);
  const outer = model.items[0].body;
  assert.equal(outer.innerAttrs, undefined);
  assert.deepEqual(outer.statements.map(entry => entry.kind), ["item", "item", "item", "tail"]);
  for (const fn of [outer.statements[0].item, outer.statements[2].item.members[0]]) {
    assert.ok(fn.attrs.includes(rustLintAttributes.nonSnakeCaseName));
    assert.deepEqual(fn.body.innerAttrs, [rustLintAttributes.nonSnakeCaseName]);
    assert.deepEqual(fn.body.statements, localBody.statements);
  }
  assert.deepEqual(finalizeRustSourceStyle(model), model);
});
