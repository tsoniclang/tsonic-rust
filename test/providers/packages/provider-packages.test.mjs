import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  acmeFilesPackage,
  acmePlatformPackage,
  acmeVectorsPackage,
  analyzeRust,
  artifactText,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "../../helpers/rust-session.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { collectRustProviderSemantics } from "../../../dist/providers/packages/index.js";
import { captureRustProviderContributions } from "../../helpers/provider-contributions.mjs";

function providerContext(selectedCapabilities) {
  return captureRustProviderContributions(selectedCapabilities);
}

test("provider data declarations have one target-model owner and no implementation-owner type aliases", () => {
  const relations = readFileSync(new URL("../../../src/target-model/identities/provider-relations.ts", import.meta.url), "utf8");
  const metadata = readFileSync(new URL("../../../src/target-model/metadata/provider-metadata.ts", import.meta.url), "utf8");
  const data = `${relations}\n${metadata}`;
  const shell = readFileSync(new URL("../../../src/providers/packages/model.ts", import.meta.url), "utf8");
  const relationDeclarations = readFileSync(new URL("../../../dist/target-model/identities/provider-relations.d.ts", import.meta.url), "utf8");
  const metadataDeclarations = readFileSync(new URL("../../../dist/target-model/metadata/provider-metadata.d.ts", import.meta.url), "utf8");
  const oldDeclarations = readFileSync(new URL("../../../dist/providers/packages/model.d.ts", import.meta.url), "utf8");
  for (const [name, owner] of [
    ["RustProviderOperationKind", "relations"], ["RustProviderImmediateCallbackDefinition", "relations"],
    ["RustProviderOperationDefinitionBase", "relations"], ["RustProviderOperationDefinition", "relations"],
    ["RustProviderTypeDefinition", "relations"], ["RustProviderTypeRow", "relations"],
    ["RustProviderOperationRow", "relations"], ["RustProviderExportRow", "relations"],
    ["RustProviderSemantics", "metadata"], ["RustProviderDispatchContextRow", "metadata"],
    ["RustProviderBinaryHookDefinitionBase", "metadata"], ["RustProviderBinaryHookDefinition", "metadata"],
    ["RustProviderBinaryHookRow", "metadata"],
  ]) {
    const declaration = new RegExp(`^(?:export )?(?:interface|type) ${name}(?:[\\s<=]|$)`, "mu");
    assert.match(owner === "relations" ? relations : metadata, declaration, `${name}: source declaration has its semantic owner`);
    assert.doesNotMatch(owner === "relations" ? metadata : relations, declaration, `${name}: no second data owner`);
    assert.match(owner === "relations" ? relationDeclarations : metadataDeclarations, declaration,
      `${name}: emitted declaration has its semantic owner`);
    assert.doesNotMatch(owner === "relations" ? metadataDeclarations : relationDeclarations, declaration,
      `${name}: no second emitted data owner`);
    assert.doesNotMatch(shell, declaration, `${name}: old source declaration is removed`);
    assert.doesNotMatch(oldDeclarations, declaration, `${name}: old declaration output is removed`);
    assert.doesNotMatch(oldDeclarations, new RegExp(`^export[^\\n]*\\b${name}\\b`, "mu"),
      `${name}: no old-owner forwarding alias is emitted`);
  }
  assert.doesNotMatch(data, /from\s+["'][^"']*providers\/packages\//u,
    "target data does not import the provider implementation owner");
  assert.doesNotMatch(data, /\bresultLoans\b/u, "data relocation does not admit the excluded result-loan schema");
  assert.equal(existsSync(new URL("../../../src/target-model/providers/model.ts", import.meta.url)), false,
    "the provisional source owner is removed, not aliased");
  assert.equal(existsSync(new URL("../../../dist/target-model/providers/model.d.ts", import.meta.url)), false,
    "the provisional declaration output is removed, not re-exported");
  const publicProvider = readFileSync(new URL("../../../dist/public/provider.d.ts", import.meta.url), "utf8");
  assert.doesNotMatch(publicProvider, /\bRustProviderSemantics\b/u,
    "the data move does not add a public Semantics export");
});

test("provider call lowers to the mapped Rust operation with cargo dependency", () => {
  const packages = [acmeFilesPackage()];
  const { result } = compileRust({
    packages,
    files: {
      "index.ts": `
import { readText } from "@acme/files";

export function load(path: string): string {
  return readText(path);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /acme_files::read_text\(path\)/u);
  assert.doesNotMatch(source, /path\.clone\(\)/u);
  const manifest = artifactText(result, "Cargo.toml");
  assert.match(manifest, /acme_files = \{ path = ".*acme_files" \}/u);
  assert.match(manifest, /tsonic_rust_runtime = \{ path = /u);
});

test("provider call records selected signature and operation facts by identity", () => {
  const packages = [acmeFilesPackage()];
  const analyzed = analyzeRust({
    packages,
    files: {
      "index.ts": `
import { readText } from "@acme/files";

export function load(path: string): string {
  return readText(path);
}
`,
    },
  });
  const { source, program } = analyzed;
  const { ast } = source;
  const sourceFile = source.sourceFiles.find((file) => ast.getFileName(file) === "/src/index.ts");
  assert.ok(sourceFile);
  let callNode;
  const visit = (node) => {
    if (ast.kindName(node) === "KindCallExpression") {
      callNode = node;
    }
    ast.forEachChild(node, (child) => child && visit(child));
  };
  visit(sourceFile);

  const selected = program.records.selectedCall.get(callNode);
  assert.equal(selected.member.id, "tsonic.rust.provider.10:acme-files47:tsonic.rust.provider-package.acme-files.binding5:1.0.010:acme.files11:@acme/files21:@acme/files::readText");
  assert.equal(selected.providerDeclaration.exportId, "@acme/files::readText");
  const operation = program.records.selectedOperation.get(callNode);
  assert.equal(operation.operationId, selected.member.id);
  assert.equal(operation.operationKind, "method");
  assert.equal(operation.targetOperation, "acme_files::read_text");
});

test("provider call argument passing facts preserve exact Rust row modes", () => {
  const analyzed = analyzeRust({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import { Vector, magnitude, scale, consume } from "@acme/vectors";
import type { int32 } from "@tsonic/core/types.js";

export function modes(value: Vector, factor: int32): int32 {
  const length = magnitude(value);
  scale(value, factor);
  return length + consume(value);
}
`,
    },
  });
  const { source, program } = analyzed;
  const { ast } = source;
  const sourceFile = source.sourceFiles.find((file) => ast.getFileName(file) === "/src/index.ts");
  assert.ok(sourceFile);
  const modes = new Map();
  const visit = (node) => {
    if (ast.kindName(node) === "KindCallExpression") {
      const selection = program.records.selectedCall.get(node);
      const exportId = selection?.providerDeclaration?.exportId;
      if (exportId !== undefined) {
        modes.set(exportId, ast.arguments(node).map((argument) =>
          argument === undefined ? undefined : program.records.argumentPassing.get(argument)?.mode));
      }
    }
    ast.forEachChild(node, (child) => child && visit(child));
  };
  visit(sourceFile);

  assert.deepEqual(modes.get("@acme/vectors::magnitude"), ["borrow-shared"]);
  assert.deepEqual(modes.get("@acme/vectors::scale"), ["borrow-mut", "by-value"]);
  assert.deepEqual(modes.get("@acme/vectors::consume"), ["by-value"]);
});

test("provider static property, constructor, instance property, and indexer lower by identity facts", () => {
  const packages = [acmePlatformPackage()];
  const { result } = compileRust({
    packages,
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Env, Store } from "@acme/platform";

export function homeDir(): string {
  return Env.homeDir;
}

export function storeProbe(): int32 {
  const store = new Store("seed");
  const count: int32 = store.count;
  const first: int32 = store[2];
  return count + first;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /acme_platform::env_home_dir\(\)/u);
  assert.match(text, /acme_platform::Store::new\(String::from\("seed"\)\)/u);
  assert.match(text, /store\.count/u);
  assert.match(text, /store\.get\(2\)/u);
});

test("provider-owned writable properties and indexers lower through exact setter rows", () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage({ includeSetters: true })],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Store } from "@acme/platform";

export function update(): int32 {
  let store = new Store("seed");
  store.count = 9;
  store[2] = 11;
  return store.count + store[2];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /store\.set_count\(9\)/u);
  assert.match(text, /store\.set\(2, 11\)/u);
});

test("provider fields remain direct writable locations when no setter row is declared", () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Store } from "@acme/platform";

export function update(): int32 {
  let store = new Store("seed");
  store.count = 9;
  return store.count;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /store\.count = 9/u);
});

test("source checking remains target-neutral for an unmapped Rust provider operation", () => {
  const strippedPackage = acmePlatformPackage({ includeHomeDir: false });
  const harness = createRustSession({
    packages: [strippedPackage],
    files: {
      "index.ts": `
import { Env } from "@acme/platform";

export function homeDir(): string {
  return Env.homeDir;
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);
  assert.equal(diagnostics, "");
});

test("unmapped provider operations block backend artifact handoff", () => {
  const strippedPackage = acmePlatformPackage({ includeHomeDir: false });
  const { result } = compileRust({
    packages: [strippedPackage],
    files: {
      "index.ts": `
import { Env } from "@acme/platform";

export function homeDir(): string {
  return Env.homeDir;
}
`,
    },
  });

  assert.deepEqual(result.artifacts, []);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "RUST_PROVIDER_OPERATION_NOT_MAPPED");
  assert.match(result.diagnostics[0].message, /No Rust operation row matches selected provider declaration 'tsonic\.rust\.provider-package\.acme-platform\.binding::acme\.platform::@acme\/platform::Env::homeDir' as property/u);
});

test("provider packages contribute cargo path dependencies through runtime contributions", () => {
  const acmeFiles = acmeFilesPackage();
  const contributions = acmeFiles.runtimeContributions({});
  assert.equal(contributions.references.length, 1);
  assert.equal(contributions.references[0].kind, "cargo-path");
  assert.equal(contributions.references[0].attributes.crate, "acme_files");
});

test("provider paths and named carriers materialize before facts reach the backend", () => {
  const providerPackage = createRustProviderPackage({
    id: "acme-materialized",
    displayName: "Acme materialized",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/materialized",
      providerModuleId: "acme.materialized",
      exports: [{
        id: "acme.materialized::create",
        name: "create",
        kind: "function",
        signatures: [{ id: "acme.materialized::create()", parameters: [], returnType: { kind: "opaque", id: "Value" } }],
      }],
    }],
    operations: [{
      exportId: "acme.materialized::create",
      operationKind: "method",
      target: { form: "call", path: "api::create" },
      resultCarrier: { kind: "target-named", id: "acme.materialized.Value" },
    }],
    aliasImports: [{ alias: "api", path: "acme_runtime::api" }],
    carrierPaths: { "acme.materialized.Value": "acme_runtime::Value" },
    carrierTraits: {
      "acme.materialized.Value": {
        implementations: [{ trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [] }],
      },
    },
    crates: [],
  });

  const semantics = collectRustProviderSemantics(providerContext([providerPackage]));
  assert.deepEqual(semantics.exports, [{
    exportId: "acme.materialized::create",
    declarationKind: "function",
    providerPackageId: "acme-materialized",
    providerId: "tsonic.rust.provider-package.acme-materialized.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.materialized",
    moduleSpecifier: "@acme/materialized",
  }]);
  assert.equal(semantics.operations[0].target.path, "acme_runtime::api::create");
  assert.deepEqual(semantics.operations[0].resultCarrier, {
    kind: "target-specific",
    target: "rust",
    name: "named-type",
    value: {
      id: "acme.materialized.Value",
      path: "acme_runtime::Value",
      traits: {
        implementations: [{ trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [] }],
      },
      genericArguments: [],
      genericDefaults: [],
      upcasts: [],
    },
  });
});

test("every path-bearing provider operation materializes its declared crate alias", () => {
  const functionExport = (name) => ({
    id: `acme.materialized::${name}`,
    name,
    kind: "function",
    signatures: [{
      id: `acme.materialized::${name}()`,
      name,
      parameters: [],
      returnType: { kind: "source-primitive", name: "int32" },
    }],
  });
  const providerPackage = createRustProviderPackage({
    id: "acme-materialized-path-forms",
    displayName: "Acme materialized path forms",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/materialized-path-forms",
      providerModuleId: "acme.materialized.path.forms",
      exports: [
        {
          id: "acme.materialized::reference",
          name: "reference",
          kind: "value",
          type: { kind: "source-primitive", name: "int32" },
        },
        functionExport("variant"),
        functionExport("parentheses"),
        functionExport("brackets"),
        functionExport("braces"),
      ],
    }],
    operations: [
      {
        exportId: "acme.materialized::reference",
        operationKind: "property",
        target: { form: "reference-path", path: "api::REFERENCE", mutable: false },
        resultCarrier: {
          kind: "reference",
          referent: { kind: "source-primitive", name: "int32" },
          mutable: false,
          lifetime: { kind: "static" },
        },
      },
      {
        exportId: "acme.materialized::variant",
        operationKind: "method",
        target: { form: "struct-variant", path: "api::Value::Variant", fields: [] },
        resultCarrier: { kind: "source-primitive", name: "int32" },
      },
      ...["parentheses", "brackets", "braces"].map((delimiter) => ({
        exportId: `acme.materialized::${delimiter}`,
        operationKind: "method",
        target: { form: "expression-macro", path: "api::value", delimiter },
        resultCarrier: { kind: "source-primitive", name: "int32" },
      })),
    ],
    aliasImports: [{ alias: "api", path: "acme_runtime::api" }],
    crates: [],
  });

  const operations = new Map(
    collectRustProviderSemantics(providerContext([providerPackage])).operations
      .map((operation) => [operation.exportId, operation]),
  );
  assert.equal(
    operations.get("acme.materialized::reference")?.target.path,
    "acme_runtime::api::REFERENCE",
  );
  assert.equal(
    operations.get("acme.materialized::variant")?.target.path,
    "acme_runtime::api::Value::Variant",
  );
  for (const delimiter of ["parentheses", "brackets", "braces"]) {
    assert.equal(
      operations.get(`acme.materialized::${delimiter}`)?.target.path,
      "acme_runtime::api::value",
    );
  }
});

test("conflicting provider carrier paths fail before operation facts are recorded", () => {
  const packageWithPath = (id, moduleSpecifier, path) => createRustProviderPackage({
    id,
    displayName: id,
    version: "1.0.0",
    modules: [{ moduleSpecifier, providerModuleId: id, exports: [] }],
    operations: [],
    carrierPaths: { "acme.Shared": path },
    crates: [],
  });

  assert.throws(
    () => collectRustProviderSemantics(providerContext([
      packageWithPath("acme-first", "@acme/first", "acme_first::Shared"),
      packageWithPath("acme-second", "@acme/second", "acme_second::Shared"),
    ])),
    /conflicting target paths 'acme_first::Shared' and 'acme_second::Shared'/u,
  );
});

test("conflicting provider carrier trait contracts fail before operation facts are recorded", () => {
  const packageWithTraits = (id, moduleSpecifier, traits) => createRustProviderPackage({
    id,
    displayName: id,
    version: "1.0.0",
    modules: [{ moduleSpecifier, providerModuleId: id, exports: [] }],
    operations: [],
    carrierPaths: { "acme.Shared": "acme_shared::Shared" },
    carrierTraits: { "acme.Shared": traits },
    crates: [],
  });

  assert.throws(
    () => collectRustProviderSemantics(providerContext([
      packageWithTraits("acme-first", "@acme/first", {
        implementations: [{ trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [] }],
      }),
      packageWithTraits("acme-second", "@acme/second", { implementations: [] }),
    ])),
    /conflicting native trait contracts/u,
  );
});
