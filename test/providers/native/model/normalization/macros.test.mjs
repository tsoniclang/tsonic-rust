import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModule } from "../../../../../dist/providers/native/model/rustdoc-model.js";
import { resolveLocalRustdocItem } from "../../../../../dist/providers/native/model/rustdoc-items.js";
import { projectRustCompilerModule } from "../../../../../dist/providers/native/projection/projection.js";
import { rustCompilerProviderProtocolVersion } from "../../../../../dist/providers/native/model/model.js";

const dependency = {
  alias: "arbitrary_alias", packageId: "arbitrary-macros 1.0.0", packageName: "arbitrary-macros",
  packageVersion: "1.0.0", crateName: "arbitrary_macros", targetCrateName: "arbitrary_alias",
  manifestPath: "/macros/Cargo.toml", sourceRoot: "/macros", sourceDigest: "macro-source",
  closurePackageIds: ["arbitrary-macros 1.0.0"], features: [],
};
const owner = { moduleSpecifier: "@tsonic/rust/crates/arbitrary_alias/index.js", providerModuleId: "arbitrary-macro-owner" };

function item(id, name, inner) {
  return { id, name, inner, visibility: "public" };
}

function document(items, paths = {}) {
  return {
    root: "root", format_version: 60, crate_version: "1.0.0",
    index: { root: item("root", "arbitrary_macros", { module: { items: items.map(value => value.id) } }),
      ...Object.fromEntries(items.map(value => [value.id, value])) },
    paths,
  };
}

function normalize(source, requestedExports, resolveItem) {
  return normalizeModule(source, { snapshot: { digest: "macro-snapshot" }, dependency,
    modulePath: [], ...(requestedExports === undefined ? {} : { requestedExports }) }, resolveItem);
}

function functionItem(id, name) {
  return item(id, name, { function: {
    sig: { inputs: [], output: { primitive: "u32" }, is_c_variadic: false },
    header: { is_const: false, is_async: false, is_unsafe: false, abi: "Rust" },
    generics: { params: [], where_predicates: [] },
  } });
}

test("all compiler macro categories bind without a name list or guessed signatures", () => {
  const module = normalize(document([
    item("declarative", "arbitrary_rules", { macro: "macro_rules! arbitrary_rules { ($input:tt) => { ... }; }" }),
    item("function", "arbitrary_expression", { proc_macro: { kind: "bang", helpers: [] } }),
    item("attribute", "arbitrary_attribute", { proc_macro: { kind: "attr", helpers: [] } }),
    item("derive", "ArbitraryDerive", { proc_macro: { kind: "derive", helpers: ["first_option", "second_option"] } }),
  ]));
  assert.deepEqual(module.unsupportedExports, []);
  assert.equal(module.protocolVersion, rustCompilerProviderProtocolVersion);
  assert.equal(module.exports.length, 4);
  assert.deepEqual(new Set(module.exports.map(value => value.macroKind)), new Set(["declarative", "function", "attribute", "derive"]));
  const projection = projectRustCompilerModule(module, owner);
  assert.equal(projection.intrinsics.length, 4);
  assert.deepEqual(projection.operations, []);
  assert.deepEqual(projection.types, []);
  assert.deepEqual([...projection.carrierPaths], []);
  for (const declaration of projection.declarationModel.exports) {
    assert.equal(declaration.kind, "intrinsic");
    assert.equal(declaration.signatures, undefined);
    assert.equal(declaration.type, undefined);
    assert.ok(projection.completeExports.has(declaration.id));
    const intrinsic = projection.intrinsics.find(value => value.exportId === declaration.id);
    assert.ok(intrinsic);
    assert.deepEqual(intrinsic.native.targetPath, ["arbitrary_alias", declaration.name]);
    assert.equal(Object.isFrozen(intrinsic.native), true);
    assert.equal(Object.isFrozen(intrinsic.native.helpers), true);
  }
  assert.deepEqual(projection.intrinsics.find(value => value.native.macroKind === "derive").native.helpers,
    ["first_option", "second_option"]);
});

test("macro identity uses the selected compiler item even when rustdoc omits a derive path", () => {
  const module = normalize(document([item(17, "Derived", { proc_macro: { kind: "derive", helpers: [] } })]));
  assert.deepEqual(module.unsupportedExports, []);
  assert.equal(module.exports[0].id, `${dependency.packageId}#17`);
  assert.equal(module.exports[0].canonicalPath, undefined);
  assert.deepEqual(module.exports[0].targetPath, ["arbitrary_alias", "Derived"]);
});

for (const suppliedResolver of [false, true]) {
  test(`renamed macros retain terminal identity with resolver ${suppliedResolver}`, () => {
    const source = document([
      item("public", null, { use: { name: "Renamed", id: "original", source: "ignored::name", is_glob: false } }),
    ]);
    source.index.original = item("original", "Original", { proc_macro: { kind: "derive", helpers: ["setting"] } });
    const module = normalize(source, ["Renamed"], suppliedResolver ? resolveLocalRustdocItem : undefined);
    assert.deepEqual(module.unsupportedExports, []);
    assert.equal(module.exports[0].id, `${dependency.packageId}#original`);
    assert.equal(module.exports[0].name, "Renamed");
    assert.deepEqual(module.exports[0].targetPath, ["arbitrary_alias", "Renamed"]);
    assert.deepEqual(module.exports[0].helpers, ["setting"]);
  });
}

test("ordinary functions and macros with one spelling keep independent identities and signatures", () => {
  const module = normalize(document([
    item("macro", "shared", { macro: "macro_rules! shared { () => { ... }; }" }),
    functionItem("function", "shared"),
  ], { function: { path: ["arbitrary_macros", "shared"], kind: "function" } }));
  assert.deepEqual(module.unsupportedExports, []);
  assert.deepEqual(module.exports.map(value => value.kind), ["function", "macro"]);
  const projection = projectRustCompilerModule(module, owner);
  assert.equal(projection.declarationModel.exports.length, 1);
  const declaration = projection.declarationModel.exports[0];
  assert.equal(declaration.kind, "function");
  assert.equal(declaration.signatures.length, 1);
  assert.equal(projection.operations.length, 1);
  assert.equal(declaration.intrinsicId, projection.intrinsics[0].exportId);
  assert.notEqual(declaration.id, declaration.intrinsicId);
  assert.equal(projection.intrinsics[0].native.id, `${dependency.packageId}#macro`);
});

test("two distinct macros with the same public name remain ambiguous", () => {
  const module = normalize(document([
    item("first", "shared", { macro: "macro_rules! shared {}" }),
    item("second", "shared", { proc_macro: { kind: "bang", helpers: [] } }),
  ]));
  assert.equal(module.exports.length, 0);
  assert.equal(module.unsupportedExports.length, 1);
  assert.match(module.unsupportedExports[0].reason, /more than one public item/u);
});

for (const inner of [
  { macro: 42 },
  { macro: "macro_rules! bad {}", proc_macro: { kind: "bang", helpers: [] } },
  { proc_macro: { kind: "unknown", helpers: [] } },
  { proc_macro: { kind: "derive", helpers: [3] } },
  { proc_macro: { kind: "derive", helpers: [""] } },
  { proc_macro: { kind: "bang", helpers: ["not_a_derive"] } },
  { proc_macro: { kind: "attr", helpers: ["not_a_derive"] } },
  { proc_macro: { kind: "derive" } },
]) {
  test(`malformed compiler macro metadata rejects: ${JSON.stringify(inner)}`, () => {
    const module = normalize(document([item("bad", "bad", inner)]));
    assert.equal(module.exports.length, 0);
    assert.equal(module.unsupportedExports.length, 1);
    assert.throws(() => projectRustCompilerModule(module, owner));
  });
}

test("present but malformed macro canonical paths are not treated as missing evidence", () => {
  for (const path of [null, {}, { path: [] }, { path: ["crate", 17] }]) {
    const module = normalize(document([item("bad", "bad", { macro: "macro_rules! bad {}" })], { bad: path }));
    assert.equal(module.exports.length, 0);
    assert.equal(module.unsupportedExports.length, 1);
  }
});

test("native macro projection retains an immutable detached input snapshot", () => {
  const module = structuredClone(normalize(document([
    item("macro", "Generated", { proc_macro: { kind: "derive", helpers: ["option"] } }),
  ])));
  const projection = projectRustCompilerModule(module, owner);
  module.exports[0].helpers[0] = "changed";
  module.exports[0].targetPath[0] = "changed";
  assert.deepEqual(projection.intrinsics[0].native.helpers, ["option"]);
  assert.deepEqual(projection.intrinsics[0].native.targetPath, ["arbitrary_alias", "Generated"]);
});
