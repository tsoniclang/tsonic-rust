import assert from "node:assert/strict";
import test from "node:test";
import { nameRustSignatureTypes } from "../../../dist/backend/target-ast/normalization/signature-aliases.js";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";

const named = (path, types = []) => ({ kind: "named", path,
  genericArguments: types.map(type => ({ kind: "type", type })) });
const nested = named("Vec", [named("Option", [named("Vec", [named("Option", [named("Vec", [named("Item")])])])])]);
const makeFunction = (name, visibility = "private") => ({ kind: "function", name, visibility,
  generics: { parameters: [{ kind: "type", name: "Item", bounds: [{ kind: "trait", path: "Clone" }] }], wherePredicates: [] },
  params: [{ name: "values", type: nested, mutable: false }], returnType: nested,
  body: { statements: [], tail: { kind: "path", path: "values" } },
});

test("signature aliases retain exact generic types, share definitions and promote visibility", () => {
  const first = makeFunction("read");
  const second = makeFunction("write", "public");
  const result = nameRustSignatureTypes([first, second]);
  const aliases = result.filter(item => item.kind === "type-alias");
  assert.equal(aliases.length, 1);
  assert.deepEqual(aliases[0].target, nested);
  assert.equal(aliases[0].visibility, "public");
  assert.deepEqual(aliases[0].generics.parameters, [{ kind: "type", name: "Item", bounds: [] }]);
  for (const fn of result.filter(item => item.kind === "function")) {
    assert.deepEqual(fn.generics, first.generics);
    assert.equal(fn.params[0].type.path, aliases[0].name);
    assert.deepEqual(fn.params[0].type.genericArguments, [{ kind: "type", type: { kind: "named", path: "Item" } }]);
    assert.equal(fn.returnType.path, aliases[0].name);
    assert.deepEqual(fn.body, first.body);
  }
  assert.deepEqual(nameRustSignatureTypes(result), result);
});

test("signature aliases avoid declarations, imports and generic parameter names", () => {
  for (const collision of [
    { kind: "struct", name: "ReadValues", visibility: "private", generics: emptyRustGenerics, fields: [], derives: [] },
    { kind: "use", path: "models::ReadValues" },
    { kind: "use", path: "models::Other", alias: "ReadValues" },
    { ...makeFunction("other"), generics: { parameters: [{ kind: "type", name: "ReadValues", bounds: [] }], wherePredicates: [] } },
  ]) {
    const result = nameRustSignatureTypes([collision, makeFunction("read")]);
    const alias = result.find(item => item.kind === "type-alias");
    assert.notEqual(alias.name, "ReadValues");
  }
});

test("complex struct fields reuse exact native aliases without changing storage or generic bounds", () => {
  const source = { kind: "struct", name: "Entries", visibility: "public", derives: [],
    generics: makeFunction("read").generics,
    fields: [{ name: "entries", type: nested, visibility: "public" },
      { name: "count", type: { kind: "primitive", name: "usize" }, visibility: "private" }],
  };
  const result = nameRustSignatureTypes([source, makeFunction("read")]);
  const aliases = result.filter(item => item.kind === "type-alias");
  const selected = result.find(item => item.kind === "struct");
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].visibility, "public");
  assert.deepEqual(aliases[0].target, nested);
  assert.deepEqual(selected.generics, source.generics);
  assert.equal(selected.fields[0].type.path, aliases[0].name);
  assert.deepEqual(selected.fields[0].type.genericArguments, [{ kind: "type", type: { kind: "named", path: "Item" } }]);
  assert.deepEqual(selected.fields[1], source.fields[1]);
  assert.deepEqual(nameRustSignatureTypes(result), result);
});

test("borrowed and opaque boundaries remain in the function instead of escaping into aliases", () => {
  const boundary = { kind: "reference", mutable: true, referent: { kind: "slice", element: nested } };
  const opaque = { kind: "impl-trait", outlives: [], captures: [], bounds: [{ kind: "callable", trait: "Fn",
    binder: [], parameters: [boundary], result: { kind: "unit" } }] };
  const result = nameRustSignatureTypes([{ ...makeFunction("read"), params: [{ name: "callback", type: opaque }], returnType: undefined }]);
  const fn = result.find(item => item.kind === "function");
  assert.equal(fn.params[0].type.kind, "impl-trait");
  const parameter = fn.params[0].type.bounds[0].parameters[0];
  assert.equal(parameter.kind, "reference");
  assert.equal(parameter.mutable, true);
  assert.equal(parameter.referent.kind, "slice");
  assert.equal(parameter.referent.element.path, result[0].name);
  assert.deepEqual(result[0].target, nested);
  const borrowedInside = named("Option", [named("Vec", [boundary])]);
  const unchanged = { ...makeFunction("read"), params: [{ name: "values", type: borrowedInside }], returnType: undefined };
  assert.deepEqual(nameRustSignatureTypes([unchanged]), [unchanged]);
});

test("const array dimensions are forwarded exactly through signature aliases", () => {
  const dimension = { kind: "path", path: "COUNT" };
  const type = named("Vec", [named("Option", [{ kind: "fixed-array", length: dimension, element: nested }])]);
  const fn = { ...makeFunction("read"), params: [{ name: "values", type }], returnType: undefined,
    generics: { parameters: [...makeFunction("read").generics.parameters,
      { kind: "const", name: "COUNT", type: { kind: "primitive", name: "usize" } }], wherePredicates: [] } };
  const result = nameRustSignatureTypes([fn]);
  assert.deepEqual(result[0].target, type);
  assert.deepEqual(result[1].params[0].type.genericArguments[1], { kind: "const", value: dimension });
});

test("impl signature aliases retain owner and call binders without moving their bounds", () => {
  const owner = { kind: "type", name: "Owner", bounds: [{ kind: "trait", path: "Clone" }] };
  const source = makeFunction("call", "public");
  const dependent = { kind: "qualified", owner: named("Owner"), trait: named("Field", [named("Item")]),
    name: "Output", genericArguments: [] };
  const type = named("Callable", [named("Option", [dependent]), named("Result", [dependent, named("Error")])]);
  const method = { ...source, selfParam: { kind: "reference", mutable: false },
    params: [{ name: "value", type }], returnType: undefined };
  const implementation = { kind: "impl", target: named("Wrapper", [named("Owner")]),
    generics: { parameters: [owner], wherePredicates: [] }, functions: [method] };
  const result = nameRustSignatureTypes([implementation]);
  const alias = result.find(item => item.kind === "type-alias");
  const native = result.find(item => item.kind === "impl");
  assert.deepEqual(alias.target, type);
  assert.deepEqual(alias.generics.parameters, ["Owner", "Item"].map(name => ({ kind: "type", name, bounds: [] })));
  assert.deepEqual(native.generics, implementation.generics);
  assert.deepEqual(native.functions[0].generics, method.generics);
  assert.deepEqual(native.functions[0].body, method.body);
  assert.deepEqual(native.functions[0].params[0].type.genericArguments,
    ["Owner", "Item"].map(path => ({ kind: "type", type: { kind: "named", path } })));
  assert.deepEqual(nameRustSignatureTypes(result), result);
});

test("impl alias allocation reserves method-local type parameter names", () => {
  const source = makeFunction("read");
  const method = { ...source, generics: { parameters: [...source.generics.parameters,
    { kind: "type", name: "ReadValues", bounds: [] }], wherePredicates: [] } };
  const result = nameRustSignatureTypes([{ kind: "impl", target: named("Container"), generics: emptyRustGenerics,
    functions: [method] }]);
  const alias = result.find(item => item.kind === "type-alias");
  assert.notEqual(alias.name, "ReadValues");
  assert.deepEqual(result.find(item => item.kind === "impl").functions[0].generics, method.generics);
});

test("body type names reuse signature aliases through nested blocks without changing storage or effects", () => {
  const source = { ...makeFunction("read", "public"), params: [], returnType: undefined,
    body: { statements: [{ kind: "scope", body: { statements: [{
      kind: "let", name: "values", mutable: false, type: nested,
      init: { kind: "block", bindings: [{ name: "input", type: nested,
        value: { kind: "path", path: "argument" } }], value: { kind: "path", path: "input" } },
    }] } }] } };
  const model = { items: [source] };
  const result = finalizeRustSourceStyle(model);
  const aliases = result.items.filter(item => item.kind === "type-alias");
  assert.equal(aliases.length, 1);
  assert.deepEqual(aliases[0].target, nested);
  assert.equal(aliases[0].visibility, "private");
  const statement = result.items.find(item => item.kind === "function").body.statements[0].body.statements[0];
  assert.equal(statement.type.path, aliases[0].name);
  assert.deepEqual(statement.init.bindings[0].type, statement.type);
  assert.deepEqual(statement.init.bindings[0].value, { kind: "path", path: "argument" });
  assert.deepEqual(statement.init.value, { kind: "path", path: "input" });
  assert.deepEqual(finalizeRustSourceStyle(result), result);
});

test("method-local Self does not escape its native impl through a module alias", () => {
  const type = named("Vec", [named("Option", [named("Vec", [named("Option", [named("Self")])])])]);
  const source = { ...makeFunction("read"), params: [{ name: "value", type }], returnType: undefined };
  assert.deepEqual(nameRustSignatureTypes([source]), [source]);
});
