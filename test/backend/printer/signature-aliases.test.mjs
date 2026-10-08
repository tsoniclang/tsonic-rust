import { rustValueBlock } from "../../../dist/backend/target-ast/value-block.js";
import assert from "node:assert/strict";
import test from "node:test";
import { nameRustSignatureTypes as nameSignatureScope } from "../../../dist/backend/target-ast/normalization/signature-aliases.js";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { closePublicRustTypeVisibility } from "../../../dist/backend/target-ast/normalization/signature-visibility.js";

function nameRustSignatureTypes(items) {
  const scope = nameSignatureScope(items);
  assert.equal(scope.items.length, items.length);
  return [...scope.aliases, ...scope.items];
}

const named = (path, types = []) => ({ kind: "named", path,
  genericArguments: types.map(type => ({ kind: "type", type })) });
const nested = named("Vec", [named("Option", [named("Vec", [named("Option", [named("Vec", [named("Item")])])])])]);
const makeFunction = (name, visibility = "private") => ({ kind: "function", name, visibility,
  generics: { parameters: [{ kind: "type", name: "Item", bounds: [{ kind: "trait", path: "Clone" }] }], wherePredicates: [] },
  params: [{ name: "values", type: nested, mutable: false }], returnType: nested,
  body: { statements: [{ kind: "tail", expr: { kind: "path", path: "values" } }] },
});

test("public signature closure removes only obsolete reachability dispositions", () => {
  const exposed = { kind: "struct", name: "Envelope", visibility: "public", generics: emptyRustGenerics,
    fields: [{ name: "value", visibility: "public", type: named("Variants") }] };
  const variants = { kind: "enum", name: "Variants", visibility: "crate", generics: emptyRustGenerics,
    deadCode: "generated-unconstructed-shape", variants: [
      { name: "First", fields: [named("Payload")], deadCode: "generated-unconstructed-variant" },
      { name: "Second", fields: [], deadCode: "authored-unused-variant" },
    ] };
  const payload = { kind: "struct", name: "Payload", visibility: "crate", generics: emptyRustGenerics,
    deadCode: "generated-unconstructed-shape", fields: [
      { name: "publicValue", visibility: "public", type: named("u64"), deadCode: "authored-unread-field" },
      { name: "privateValue", visibility: "private", type: named("u64"), deadCode: "authored-unread-field" },
    ] };
  const retained = { ...variants, name: "Internal", variants: variants.variants.map(variant => ({ ...variant, fields: [] })) };
  const scopedPublic = { ...exposed, name: "UnusedPublic", deadCode: "authored-declaration", fields: [] };
  const before = [exposed, variants, payload, retained, scopedPublic];
  const result = closePublicRustTypeVisibility(before);
  assert.equal(result[1].visibility, "public");
  assert.equal(Object.hasOwn(result[1], "deadCode"), false);
  assert.equal(result[1].variants.every(variant => !Object.hasOwn(variant, "deadCode")), true);
  assert.equal(result[2].visibility, "public");
  assert.equal(Object.hasOwn(result[2], "deadCode"), false);
  assert.equal(Object.hasOwn(result[2].fields[0], "deadCode"), false);
  assert.equal(result[2].fields[1], payload.fields[1], "private field reachability is not widened");
  assert.equal(result[3], retained, "private variant diagnostics remain exact");
  assert.equal(result[4], scopedPublic, "existing visibility retains its exact enclosing module reachability policy");
  assert.equal(variants.deadCode, "generated-unconstructed-shape", "input AST is not mutated");
  assert.deepEqual(closePublicRustTypeVisibility(result), result, "one idempotent public closure");
});

test("native lifetime arguments stay exact in factored aliases", () => {
  for (const lifetime of [{ kind: "static" }, { kind: "named", name: "scope" }]) {
    const type = { ...nested, genericArguments: [{ kind: "lifetime", lifetime }, ...nested.genericArguments] };
    const source = { ...makeFunction("read"), params: [{ name: "values", type }], returnType: undefined,
      generics: { parameters: [...makeFunction("read").generics.parameters,
        { kind: "lifetime", name: "scope", outlives: [] }], wherePredicates: [] } };
    const result = nameRustSignatureTypes([source]);
    assert.deepEqual(result[0].target, type);
    assert.deepEqual(result[0].generics.parameters.map(parameter => parameter.name),
      lifetime.kind === "static" ? ["Item"] : ["Item", "scope"]);
    assert.deepEqual(nameRustSignatureTypes(result), result);
  }
  const type = { ...nested, genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }, ...nested.genericArguments] };
  const source = { ...makeFunction("read"), params: [{ name: "values", type }], returnType: undefined };
  assert.deepEqual(nameRustSignatureTypes([source]), [source]);
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
    { kind: "struct", name: "ReadValues", visibility: "private", generics: emptyRustGenerics, fields: [] },
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
  const source = { kind: "struct", name: "Entries", visibility: "public",
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

test("generated trait signatures share exact aliases with implementations without changing their native contracts", () => {
  const callable = makeFunction("read");
  const { visibility: _visibility, body: _body, ...callableSignature } = callable;
  const signature = { ...callableSignature, generics: emptyRustGenerics };
  const associated = { kind: "type", name: "Output", bounds: [] };
  const trait = { kind: "trait", name: "Reader", visibility: "public", generics: callable.generics,
    members: [signature, associated] };
  const result = nameRustSignatureTypes([callable, trait]);
  const aliases = result.filter(item => item.kind === "type-alias");
  const selected = result.find(item => item.kind === "trait");
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].visibility, "public");
  assert.deepEqual(aliases[0].target, nested);
  assert.deepEqual(selected.generics, trait.generics);
  assert.equal(selected.members[0].params[0].type.path, aliases[0].name);
  assert.equal(selected.members[0].returnType.path, aliases[0].name);
  assert.deepEqual(selected.members[0].generics, signature.generics);
  assert.deepEqual(selected.members[1], associated);
  assert.deepEqual(result.find(item => item.kind === "function").body, callable.body);
  assert.deepEqual(nameRustSignatureTypes(result), result);
});

test("trait aliases preserve native owner binders and reserve method-local parameters", () => {
  const callable = makeFunction("read");
  const { visibility: _visibility, body: _body, ...signature } = callable;
  const type = { ...nested, genericArguments: [
    { kind: "lifetime", lifetime: { kind: "named", name: "scope" } },
    { kind: "const", value: { kind: "path", path: "CAPACITY" } },
    ...nested.genericArguments,
  ] };
  const generics = { parameters: [
    ...callable.generics.parameters,
    { kind: "lifetime", name: "scope", outlives: [] },
    { kind: "const", name: "CAPACITY", type: { kind: "primitive", name: "usize" } },
  ], wherePredicates: [] };
  const method = { ...signature, params: [{ name: "values", type }], returnType: type,
    generics: { parameters: [{ kind: "type", name: "ReadValues", bounds: [] }], wherePredicates: [] } };
  const trait = { kind: "trait", name: "Reader", visibility: "public", generics, members: [method] };
  const result = nameRustSignatureTypes([trait]);
  const alias = result.find(item => item.kind === "type-alias");
  const selected = result.find(item => item.kind === "trait");
  assert.equal(alias.name, "ReadValues2");
  assert.deepEqual(alias.target, type);
  assert.deepEqual(alias.generics.parameters.map(parameter => parameter.name), ["Item", "scope", "CAPACITY"]);
  assert.deepEqual(selected.generics, generics);
  assert.deepEqual(selected.members[0].generics, method.generics);
  assert.deepEqual(selected.members[0].params[0].type.genericArguments, [
    { kind: "type", type: { kind: "named", path: "Item" } },
    { kind: "lifetime", lifetime: { kind: "named", name: "scope" } },
    { kind: "const", value: { kind: "path", path: "CAPACITY" } },
  ]);
  assert.deepEqual(nameRustSignatureTypes(result), result);
  const selfType = named("Vec", [named("Option", [named("Vec", [named("Option", [named("Vec", [named("Self")])])])])]);
  const selfTrait = { ...trait, members: [{ ...method, params: [{ name: "values", type: selfType }], returnType: selfType }] };
  assert.deepEqual(nameRustSignatureTypes([selfTrait]), [selfTrait]);
});

test("borrowed and opaque boundaries remain in the function instead of escaping into aliases", () => {
  const boundary = { kind: "reference", mutable: true, referent: { kind: "slice", element: nested } };
  const opaque = { kind: "impl-trait", outlives: [], bounds: [{ kind: "callable", trait: "Fn",
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
    generics: { parameters: [owner], wherePredicates: [] }, members: [method] };
  const result = nameRustSignatureTypes([implementation]);
  const alias = result.find(item => item.kind === "type-alias");
  const native = result.find(item => item.kind === "impl");
  assert.deepEqual(alias.target, type);
  assert.deepEqual(alias.generics.parameters, ["Owner", "Item"].map(name => ({ kind: "type", name, bounds: [] })));
  assert.deepEqual(native.generics, implementation.generics);
  assert.deepEqual(native.members[0].generics, method.generics);
  assert.deepEqual(native.members[0].body, method.body);
  assert.deepEqual(native.members[0].params[0].type.genericArguments,
    ["Owner", "Item"].map(path => ({ kind: "type", type: { kind: "named", path } })));
  assert.deepEqual(nameRustSignatureTypes(result), result);
});

test("impl alias allocation reserves method-local type parameter names", () => {
  const source = makeFunction("read");
  const method = { ...source, generics: { parameters: [...source.generics.parameters,
    { kind: "type", name: "ReadValues", bounds: [] }], wherePredicates: [] } };
  const result = nameRustSignatureTypes([{ kind: "impl", target: named("Container"), generics: emptyRustGenerics,
    members: [method] }]);
  const alias = result.find(item => item.kind === "type-alias");
  assert.notEqual(alias.name, "ReadValues");
  assert.deepEqual(result.find(item => item.kind === "impl").members[0].generics, method.generics);
});

test("body type names reuse signature aliases through nested blocks without changing storage or effects", () => {
  const source = { ...makeFunction("read", "public"), params: [], returnType: undefined,
    body: { statements: [{ kind: "scope", body: { statements: [{
      kind: "let", name: "values", mutable: false, type: nested,
      init: rustValueBlock([{ name: "input", type: nested,
        value: { kind: "path", path: "argument" } }], { kind: "path", path: "input" }),
    }] } }] } };
  const model = { items: [source] };
  const result = finalizeRustSourceStyle(model);
  const aliases = result.items.filter(item => item.kind === "type-alias");
  assert.equal(aliases.length, 1);
  assert.deepEqual(aliases[0].target, nested);
  assert.equal(aliases[0].visibility, "private");
  const statement = result.items.find(item => item.kind === "function").body.statements[0].body.statements[0];
  assert.equal(statement.type.path, aliases[0].name);
  assert.deepEqual(statement.init.body.statements[0].type, statement.type);
  assert.deepEqual(statement.init.body.statements[0].init, { kind: "path", path: "argument" });
  assert.deepEqual(statement.init.body.statements.at(-1).expr, { kind: "path", path: "input" });
  assert.deepEqual(finalizeRustSourceStyle(result), result);
});

test("typed closure signatures reuse the owning alias with exact scope and generic arguments", () => {
  for (const kind of ["closure", "closure-block"]) {
    const body = { kind: "path", path: "values" };
    const closure = { kind, move: true, params: [{ name: "values", type: nested, mutable: false }],
      body: kind === "closure" ? body : { statements: [{ kind: "tail", expr: body }] } };
    const source = { ...makeFunction("read"), params: [], returnType: undefined,
      body: { statements: [{ kind: "let", name: "callback", mutable: false, init: closure }] } };
    const result = finalizeRustSourceStyle({ items: [source] });
    const aliases = result.items.filter(item => item.kind === "type-alias");
    assert.equal(aliases.length, 1);
    assert.deepEqual(aliases[0].target, nested);
    assert.deepEqual(aliases[0].generics.parameters, [{ kind: "type", name: "Item", bounds: [] }]);
    assert.equal(aliases[0].visibility, "private");
    const emitted = result.items.find(item => item.kind === "function").body.statements[0].init;
    assert.deepEqual(emitted.params[0].type, { kind: "named", path: aliases[0].name,
      genericArguments: [{ kind: "type", type: { kind: "named", path: "Item" } }] });
    assert.equal(emitted.move, true);
    assert.deepEqual(emitted.body, closure.body);
    assert.deepEqual(finalizeRustSourceStyle(result), result);
  }
});

test("method-local Self does not escape its native impl through a module alias", () => {
  const type = named("Vec", [named("Option", [named("Vec", [named("Option", [named("Self")])])])]);
  const source = { ...makeFunction("read"), params: [{ name: "value", type }], returnType: undefined };
  assert.deepEqual(nameRustSignatureTypes([source]), [source]);
});

test("local signature aliases stay in the original block and reserve every local item name", () => {
  const collision = { kind: "struct", name: "ReadValues", visibility: "private", generics: emptyRustGenerics, fields: [] };
  const before = { kind: "expr", expr: { kind: "call", callee: { kind: "path", path: "before" }, args: [] } };
  const after = { kind: "expr", expr: { kind: "call", callee: { kind: "path", path: "after" }, args: [] } };
  const source = { kind: "function", name: "outer", visibility: "public", generics: emptyRustGenerics, params: [],
    body: { statements: [before, { kind: "item", item: collision },
      { kind: "item", item: makeFunction("read") }, { kind: "item", item: makeFunction("write") }, after] } };
  const normalized = finalizeRustSourceStyle({ items: [source] });
  assert.equal(normalized.items.length, 1);
  const statements = normalized.items[0].body.statements;
  const alias = statements[0].item;
  assert.equal(alias.kind, "type-alias");
  assert.notEqual(alias.name, "ReadValues");
  assert.deepEqual(alias.target, nested);
  assert.deepEqual(statements[1], before);
  assert.equal(statements[2].item.name, "ReadValues");
  assert.deepEqual(statements.slice(3, 5).map(entry => entry.item.name), ["read", "write"]);
  for (const entry of statements.slice(3, 5)) assert.equal(entry.item.params[0].type.path, alias.name);
  assert.deepEqual(statements[5], after);
  assert.deepEqual(finalizeRustSourceStyle(normalized), normalized);
});
