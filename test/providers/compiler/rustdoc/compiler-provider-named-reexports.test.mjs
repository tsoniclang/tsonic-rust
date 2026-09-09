import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeModule } from "../../../../dist/providers/compiler/model/rustdoc-model.js";
import {
  compilerAssociatedSourceExportName,
  resolveLocalRustdocItem,
} from "../../../../dist/providers/compiler/model/rustdoc-items.js";
import { projectRustCompilerModule } from "../../../../dist/providers/compiler/projection/projection.js";
import {
  compilerModuleSpecifier,
  compilerProviderModuleId,
  compilerTargetTypeId,
} from "../../../../dist/providers/compiler/projection/operations.js";
import { resolveStandardLibraryItem } from "../../../../dist/providers/compiler/projection/standard-library.js";

const dependency = {
  alias: "widget_alias",
  packageId: "acme-widget 1.0.0",
  packageName: "acme-widget",
  packageVersion: "1.0.0",
  crateName: "acme_widget",
  targetCrateName: "widget_alias",
  manifestPath: "/named-reexports/Cargo.toml",
  sourceRoot: "/named-reexports",
  sourceDigest: "named-reexports",
  closurePackageIds: ["acme-widget 1.0.0"],
  features: [],
};

test("private named and renamed exports retain terminal IDs and selected public paths", () => {
  const document = privateReexports();
  const module = normalize(document);
  assert.deepEqual(module.unsupportedExports, []);
  assert.deepEqual(module.exports.map(({ id, name, canonicalPath, targetPath }) => ({
    id, name, canonicalPath, targetPath,
  })), [
    {
      id: `${dependency.packageId}#record`,
      name: "PublicRecord",
      canonicalPath: ["acme_widget", "implementation", "Record"],
      targetPath: ["widget_alias", "PublicRecord"],
    },
    {
      id: `${dependency.packageId}#make`,
      name: "create_record",
      canonicalPath: ["acme_widget", "implementation", "make_record"],
      targetPath: ["widget_alias", "create_record"],
    },
    {
      id: `${dependency.packageId}#read`,
      name: "read_value",
      canonicalPath: ["acme_widget", "implementation", "read_value"],
      targetPath: ["widget_alias", "read_value"],
    },
  ]);
  assert.equal(module.exports.find(({ name }) => name === "create_record").function.name, "make_record");
  assert.equal(document.index.implementation, undefined);
  assert.equal(document.paths["use-record"], undefined);
});

test("returned nominal closure uses the selected public export and one canonical carrier", () => {
  const module = normalize(privateReexports(), ["create_record"]);
  assert.deepEqual(module.unsupportedExports, []);
  assert.deepEqual(module.exports.map(({ name }) => name), ["PublicRecord", "create_record"]);
  const record = module.exports.find(({ name }) => name === "PublicRecord");
  const fn = module.exports.find(({ name }) => name === "create_record").function;
  assert.deepEqual(fn.result.identity, { itemId: record.id, canonicalPath: record.canonicalPath });
  const projection = project(module);
  const declaration = projection.declarationModel.exports.find(({ name }) => name === "create_record");
  assert.deepEqual(declaration.signatures[0].returnType, {
    kind: "provider-ref",
    moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    exportName: "PublicRecord",
  });
  const operation = projection.operations.find(({ target }) => target.form === "call");
  assert.deepEqual(operation.target, { form: "call", path: "widget_alias::create_record" });
  const carrierId = compilerTargetTypeId(dependency, record.canonicalPath);
  assert.equal(operation.resultCarrier.value.id, carrierId);
  assert.equal(projection.types[0].targetCarrier.value.id, carrierId);
  assert.equal(projection.operations.find(({ operationKind }) => operationKind === "property").receiverCarrier.value.id, carrierId);
  assert.deepEqual([...projection.carrierPaths], [[carrierId, "widget_alias::PublicRecord"]]);
  assert.equal((projection.declarationModel.imports ?? []).some(({ moduleSpecifier }) =>
    moduleSpecifier.includes("implementation")), false);
});

test("public nominal projection preserves explicit generic arguments", () => {
  const document = privateReexports();
  document.index.record.inner.struct.generics.params.push({
    name: "Value",
    kind: { type: { bounds: [], default: null, is_synthetic: false } },
  });
  document.index.field.inner.struct_field = { generic: "Value" };
  document.index.make.inner.function.sig.output.resolved_path.args = {
    angle_bracketed: { args: [{ type: { primitive: "i32" } }], constraints: [] },
  };
  const module = normalize(document, ["create_record"]);
  assert.deepEqual(module.unsupportedExports, []);
  const projection = project(module);
  const declaration = projection.declarationModel.exports.find(({ name }) => name === "create_record");
  assert.deepEqual(declaration.signatures[0].returnType, {
    kind: "provider-ref",
    moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    exportName: "PublicRecord",
    typeArguments: [{ kind: "source-primitive", name: "int32" }],
  });
  const result = projection.operations.find(({ target }) => target.form === "call").resultCarrier;
  assert.equal(result.value.id, projection.types[0].targetCarrier.value.id);
  assert.deepEqual(result.value.genericArguments, [{ kind: "type", type: { kind: "source-primitive", name: "int32" } }]);
});

test("local chains follow numeric and string IDs, not source spelling or intermediate names", () => {
  const document = privateReexports();
  document.index["use-make"].inner.use.id = 0;
  document.index["0"] = namedUse(0, "intermediate_name", "make");
  document.index["use-make"].inner.use.source = "implementation::read_value";
  const selected = resolveLocalRustdocItem(document, dependency, "use-make");
  assert.equal(selected.item, document.index.make);
  assert.equal(selected.publicName, "create_record");
  assert.equal(resolveLocalRustdocItem(document, dependency, "0").item, document.index.make);
  assert.equal(document.paths["0"], undefined);
  const module = normalize(document, ["create_record"]);
  assert.deepEqual(module.unsupportedExports, []);
  assert.equal(module.exports.find(({ name }) => name === "create_record").id, `${dependency.packageId}#make`);
  assert.deepEqual(resolveStandardLibraryItem({}, document, dependency, "use-make"), selected);
});

for (const [label, selectedId, expected] of [
  ["null target", null, /no exact selected rustdoc item identifier/u],
  ["missing target despite matching canonical path", "missing", /'missing' is missing from the selected local document/u],
  ["self cycle", "use-make", /cycle at rustdoc item 'use-make'/u],
  ["multi-item cycle", "cycle", /cycle at rustdoc item 'use-make'/u],
]) {
  test(`named reexports fail closed for ${label}`, () => {
    const document = privateReexports();
    document.index["use-make"].inner.use.id = selectedId;
    document.index.cycle = namedUse("cycle", "create_record", "use-make");
    document.paths.missing = document.paths.make;
    assert.throws(() => resolveLocalRustdocItem(document, dependency, "use-make"), expected);
    const module = normalize(document, ["create_record"]);
    assert.deepEqual(module.exports, []);
    assert.equal(module.unsupportedExports[0].name, "create_record");
    assert.match(module.unsupportedExports[0].reason, expected);
    assert.deepEqual(normalize(document, ["read_value"]).unsupportedExports, []);
  });
}

test("selected local index entries cannot substitute a different item ID", () => {
  const document = privateReexports();
  document.index.make.id = "read";
  assert.throws(() => resolveLocalRustdocItem(document, dependency, "use-make"),
    /index entry 'make' has a different item identifier/u);
});

test("module lookup rejects a named export rebound to another valid use item ID", () => {
  const document = privateReexports();
  const selected = normalize(document, ["create_record"]);
  assert.deepEqual(selected.unsupportedExports, []);
  assert.equal(selected.exports.find(({ name }) => name === "create_record").id, `${dependency.packageId}#make`);
  assert.equal(normalize(document, ["read_value"]).exports[0].id, `${dependency.packageId}#read`);
  document.index["use-make"].id = "use-read";
  assert.equal(document.index["use-read"].id, "use-read");
  assert.throws(() => normalize(document, ["create_record"]),
    /index entry 'use-make' has a different item identifier/u);
});

for (const [memberName, memberKind, targetForm] of [
  ["read", "method", "trait-call"],
  ["VALUE", "constant", "trait-associated-value"],
]) {
  test(`demanding only PublicRecord.${memberName} closes over its exact reexported trait owner`, () => {
    const document = privateReaderReexports(memberKind);
    const module = normalize(document, ["PublicRecord"]);
    assert.deepEqual(module.unsupportedExports, []);
    assert.deepEqual(module.exports.map(({ id, name }) => ({ id, name })), [
      { id: `${dependency.packageId}#reader`, name: "PublicReader" },
      { id: `${dependency.packageId}#record`, name: "PublicRecord" },
    ]);
    const record = module.exports.find(({ name }) => name === "PublicRecord");
    assert.deepEqual(record.unsupportedMembers, []);
    const member = (memberKind === "method" ? record.methods : record.associatedConstants)
      .find(({ name }) => name === memberName);
    assert.deepEqual(member.traitDispatch.identity, {
      itemId: `${dependency.packageId}#reader`,
      canonicalPath: ["acme_widget", "implementation", "Reader"],
    });
    const projection = project(module);
    const declaration = projection.declarationModel.exports.find(({ name }) => name === "PublicRecord");
    assert.ok(declaration.members.some(({ name }) => name === memberName));
    const operation = projection.operations.find(({ exportId, target }) =>
      exportId === declaration.id && target.form === targetForm);
    assert.ok(operation);
    assert.equal(operation.target.traitPath, "widget_alias::PublicReader");
    assert.equal(projection.carrierPaths.get(compilerTargetTypeId(dependency, member.traitDispatch.identity.canonicalPath)),
      "widget_alias::PublicReader");
    assert.deepEqual(projection.carrierTraits.get(compilerTargetTypeId(dependency, record.canonicalPath)), {
      implementations: [{ traitPath: "widget_alias::PublicReader", requirements: [] }],
    });
    assert.equal([...projection.carrierPaths.values()].some((path) => path.includes("implementation::")), false);
    assert.equal((projection.declarationModel.imports ?? []).some(({ moduleSpecifier }) =>
      moduleSpecifier.includes("implementation")), false);
  });
}

for (const [label, targetId, expected] of [
  ["missing", "missing", /'missing' is missing from the selected local document/u],
  ["cyclic", "use-make", /cycle at rustdoc item 'use-make'/u],
]) {
  test(`associated-source demand ignores an unrelated ${label} reexport, not its selected error`, () => {
    const document = privateReexports();
    document.index["use-make"].inner.use.id = targetId;
    document.index["use-trait"] = namedUse("use-trait", "PublicTrait", "trait");
    document.index.root.inner.module.items.push("use-trait");
    document.index.trait = item("trait", "NativeTrait", {
      trait: {
        generics: { params: [], where_predicates: [] },
        bounds: [],
        items: ["associated", "trait-method"],
        is_auto: false,
        is_unsafe: false,
      },
    });
    document.paths.trait = { kind: "trait", path: ["acme_widget", "implementation", "NativeTrait"] };
    document.index.associated = item("associated", "Output", {
      assoc_type: { generics: { params: [], where_predicates: [] }, bounds: [], type: null },
    });
    document.index["trait-method"] = functionItem("trait-method", "value", { primitive: "i32" });
    document.index["trait-method"].inner.function.sig.inputs = [[
      "self", { borrowed_ref: { lifetime: null, is_mutable: false, type: { generic: "Self" } } },
    ]];
    const associatedId = `${dependency.packageId}#trait\0associated:Output`;
    const associatedName = compilerAssociatedSourceExportName(associatedId, "Output");
    const module = normalize(document, [associatedName]);
    assert.deepEqual(module.unsupportedExports, []);
    assert.deepEqual(module.exports.map(({ id, name }) => ({ id, name })), [
      { id: `${dependency.packageId}#trait`, name: "PublicTrait" },
    ]);
    assert.equal(module.exports[0].associatedTypes[0].identity.itemId, associatedId);
    assert.deepEqual(module.exports[0].unsupportedMembers, []);
    const projection = project(module);
    const associated = projection.declarationModel.exports.find(({ name }) => name === associatedName);
    assert.ok(associated);
    assert.equal(projection.types.find(({ exportId }) => exportId === associated.id)
      .targetCarrier.trait.path, "widget_alias::PublicTrait");
    assert.equal(projection.operations.find(({ target }) => target.form === "trait-call")
      .target.traitPath, "widget_alias::PublicTrait");
    assert.equal((projection.declarationModel.imports ?? []).some(({ moduleSpecifier }) =>
      moduleSpecifier.includes("implementation")), false);
    const selectedBadExport = normalize(document, [associatedName, "create_record"]);
    assert.deepEqual(selectedBadExport.exports.map(({ name }) => name), ["PublicTrait"]);
    assert.equal(selectedBadExport.unsupportedExports[0].name, "create_record");
    assert.match(selectedBadExport.unsupportedExports[0].reason, expected);
    assert.throws(() => project(selectedBadExport), expected);
  });
}

test("standard-library resolution retains its exact cross-document lookup after the local walk", () => {
  const document = privateReexports();
  document.index["use-make"].inner.use.id = "external-function";
  document.paths["external-function"] = { kind: "function", path: ["core", "selected", "make_record"] };
  const coreDependency = { ...dependency, crateName: "core", packageId: "core 1.0.0" };
  const coreDocument = {
    root: "core-root",
    index: {
      selected: functionItem("selected", "make_record", null),
      decoy: functionItem("decoy", "make_record", null),
    },
    paths: {
      selected: document.paths["external-function"],
      decoy: { kind: "function", path: ["core", "other", "make_record"] },
    },
  };
  const context = {
    snapshot: { dependencies: [coreDependency] },
    documentsByCrate: new Map([["core", coreDocument]]),
    itemIdsByCanonicalIdentity: new Map(),
  };
  const selected = resolveStandardLibraryItem(context, document, dependency, "use-make");
  assert.equal(selected.item, coreDocument.index.selected);
  assert.equal(selected.document, coreDocument);
  assert.equal(selected.dependency, coreDependency);
  assert.equal(selected.publicName, "create_record");
  assert.throws(() => resolveLocalRustdocItem(document, dependency, "use-make"),
    /'external-function' is missing from the selected local document/u);
});

test("ordinary external type references remain path-only when their item is absent", () => {
  const document = privateReexports();
  document.index.make.inner.function.sig.output = resolvedPath("external");
  document.paths.external = { kind: "struct", path: ["other_crate", "PublicRecord"] };
  const module = normalize(document, ["create_record"]);
  assert.deepEqual(module.unsupportedExports, []);
  assert.deepEqual(module.exports.map(({ name }) => name), ["create_record"]);
  assert.equal(document.index.external, undefined);
  assert.deepEqual(module.exports[0].function.result.identity, {
    itemId: `${dependency.packageId}#external`,
    canonicalPath: ["other_crate", "PublicRecord"],
  });
  assert.throws(() => project(module), /has no target carrier contract/u);
});

test("an unresolved alias cannot replace a resolved public nominal dependency", () => {
  const document = privateReexports();
  document.index["bad-record"] = namedUse("bad-record", "MissingRecord", "missing-record");
  document.paths["missing-record"] = document.paths.record;
  document.index.root.inner.module.items.push("bad-record");
  const module = normalize(document, ["create_record"]);
  assert.deepEqual(module.unsupportedExports, []);
  assert.deepEqual(module.exports.map(({ name }) => name), ["PublicRecord", "create_record"]);
  assert.deepEqual([...project(module).carrierPaths.values()], ["widget_alias::PublicRecord"]);
  const selected = normalize(document, ["MissingRecord"]);
  assert.deepEqual(selected.exports, []);
  assert.equal(selected.unsupportedExports[0].name, "MissingRecord");
  assert.match(selected.unsupportedExports[0].reason, /'missing-record' is missing from the selected local document/u);
});

test("named module selection follows IDs while existing local glob expansion is retained", () => {
  const document = privateReexports();
  document.index.facade = item("facade", "native_facade", {
    module: { items: document.index.root.inner.module.items },
  });
  document.paths.facade = { kind: "module", path: ["acme_widget", "implementation", "native_facade"] };
  document.index["use-facade"] = namedUse("use-facade", "facade", "facade");
  document.index.root.inner.module.items = ["use-facade"];
  const module = normalize(document, ["create_record"], ["facade"]);
  assert.deepEqual(module.unsupportedExports, []);
  assert.deepEqual(module.exports.map(({ targetPath }) => targetPath), [
    ["widget_alias", "facade", "PublicRecord"],
    ["widget_alias", "facade", "create_record"],
  ]);
  const projection = project(module);
  assert.equal(projection.declarationModel.exports.find(({ name }) => name === "create_record")
    .signatures[0].returnType.moduleSpecifier, "@tsonic/rust/crates/widget_alias/facade.js");
  document.index["use-facade"].inner.use.is_glob = true;
  assert.throws(() => resolveLocalRustdocItem(document, dependency, "use-facade"), /no singular selected export identity/u);
  assert.deepEqual(normalize(document, ["create_record"]).exports.map(({ targetPath }) => targetPath), [
    ["widget_alias", "PublicRecord"],
    ["widget_alias", "create_record"],
  ]);
  document.index.facade.id = "root";
  assert.throws(() => normalize(document, ["create_record"]),
    /index entry 'facade' has a different item identifier/u);
});

test("conflicting public paths cannot produce two carriers for one canonical nominal", () => {
  const document = privateReexports();
  document.index["second-record"] = namedUse("second-record", "SecondRecord", "record");
  document.index.root.inner.module.items.push("second-record");
  const module = normalize(document, ["PublicRecord", "SecondRecord"]);
  assert.deepEqual(module.unsupportedExports, []);
  assert.throws(() => project(module), /maps to both 'widget_alias::PublicRecord' and 'widget_alias::SecondRecord'/u);
});

function normalize(document, requestedExports, modulePath = []) {
  return normalizeModule(document, {
    snapshot: { digest: "named-reexports" },
    dependency,
    modulePath,
    ...(requestedExports === undefined ? {} : { requestedExports }),
  });
}

function project(module) {
  return projectRustCompilerModule(module, {
    providerModuleId: compilerProviderModuleId(dependency, module.modulePath),
    moduleSpecifier: compilerModuleSpecifier(dependency.alias, module.modulePath),
  });
}

function privateReexports() {
  return {
    root: "root",
    format_version: 60,
    crate_version: "1.0.0",
    index: {
      root: item("root", "acme_widget", { module: { items: ["use-record", "use-make", "use-read"] } }),
      "use-record": namedUse("use-record", "PublicRecord", "record"),
      "use-make": namedUse("use-make", "create_record", "make"),
      "use-read": namedUse("use-read", "read_value", "read"),
      record: item("record", "Record", {
        struct: {
          kind: { plain: { fields: ["field"], has_stripped_fields: false } },
          generics: { params: [], where_predicates: [] },
          impls: [],
        },
      }),
      field: item("field", "value", { struct_field: { primitive: "i32" } }),
      make: functionItem("make", "make_record", resolvedPath("record")),
      read: functionItem("read", "read_value", { primitive: "i32" }),
    },
    paths: {
      record: { kind: "struct", path: ["acme_widget", "implementation", "Record"] },
      make: { kind: "function", path: ["acme_widget", "implementation", "make_record"] },
      read: { kind: "function", path: ["acme_widget", "implementation", "read_value"] },
    },
  };
}

function privateReaderReexports(memberKind) {
  const document = privateReexports();
  document.index["use-reader"] = namedUse("use-reader", "PublicReader", "reader");
  document.index["use-other-reader"] = namedUse("use-other-reader", "OtherReader", "other-reader");
  document.index.root.inner.module.items.push("use-reader", "use-other-reader");
  document.index.record.inner.struct.impls.push("record-reader");
  document.index.reader = item("reader", "Reader", {
    trait: {
      generics: { params: [], where_predicates: [] },
      bounds: [],
      items: ["reader-member"],
      is_auto: false,
      is_unsafe: false,
    },
  });
  document.index["other-reader"] = item("other-reader", "Reader", {
    trait: { ...document.index.reader.inner.trait, items: [] },
  });
  document.paths.reader = { kind: "trait", path: ["acme_widget", "implementation", "Reader"] };
  document.paths["other-reader"] = { kind: "trait", path: ["acme_widget", "other", "Reader"] };
  document.index["record-reader"] = item("record-reader", null, {
    impl: {
      generics: { params: [], where_predicates: [] },
      trait: { id: "reader", path: "other::Reader", args: null },
      for: resolvedPath("record"),
      items: ["impl-member"],
      is_unsafe: false,
      is_negative: false,
      is_synthetic: false,
      blanket_impl: null,
    },
  });
  for (const memberId of ["reader-member", "impl-member"]) {
    if (memberKind === "method") {
      document.index[memberId] = functionItem(memberId, "read", { primitive: "i32" });
      document.index[memberId].inner.function.sig.inputs = [[
        "self", { borrowed_ref: { lifetime: null, is_mutable: false, type: { generic: "Self" } } },
      ]];
    } else {
      document.index[memberId] = item(memberId, "VALUE", { assoc_const: { type: { primitive: "i32" }, value: "7" } });
    }
    document.index[memberId].visibility = "default";
  }
  return document;
}

function item(id, name, inner) {
  return { id, name, visibility: "public", inner };
}

function namedUse(id, name, selectedId) {
  return item(id, null, { use: { name, id: selectedId, source: "unselected::spelling", is_glob: false } });
}

function resolvedPath(id) {
  return { resolved_path: { path: "unselected::spelling", id, args: null } };
}

function functionItem(id, name, output) {
  return item(id, name, {
    function: {
      sig: { inputs: [], output, is_c_variadic: false },
      header: { is_const: false, is_async: false, is_unsafe: false, abi: "Rust" },
      generics: { params: [], where_predicates: [] },
    },
  });
}
