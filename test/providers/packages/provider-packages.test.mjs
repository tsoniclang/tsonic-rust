import { test } from "node:test";
import assert from "node:assert/strict";
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
import {
  createRustProviderPackage,
  rustCloneTrait,
  rustProviderPathTargetType,
} from "../../../dist/public/provider.js";
import {
  collectRustProviderSemantics,
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../../../dist/providers/packages/index.js";
import { captureRustProviderContributions } from "../../helpers/provider-contributions.mjs";

function providerContext(selectedCapabilities) {
  return captureRustProviderContributions(selectedCapabilities);
}

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
  assert.match(source, /acme_files::read_text\(path\.clone\(\)\)/u);
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

  const selected = program.facts.getSelectedTargetCall(callNode);
  assert.equal(selected.member.id, "tsonic.rust.provider.10:acme-files47:tsonic.rust.provider-package.acme-files.binding5:1.0.010:acme.files11:@acme/files21:@acme/files::readText");
  assert.equal(selected.providerDeclaration.exportId, "@acme/files::readText");
  const operation = program.facts.getSelectedTargetOperation(callNode);
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
      const selection = program.facts.getSelectedTargetCall(node);
      const exportId = selection?.providerDeclaration?.exportId;
      if (exportId !== undefined) {
        modes.set(exportId, ast.arguments(node).map((argument) =>
          argument === undefined ? undefined : program.facts.getArgumentPassingFact(argument)?.mode));
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
  const resultCarrier = rustProviderPathTargetType({
    owner: { packageId: "acme-materialized", packageVersion: "1.0.0" },
    itemId: "acme.materialized.Value",
    displayPath: "acme_runtime::Value",
    traitImplementations: [{ trait: rustCloneTrait, requirements: [] }],
  });
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
      resultCarrier,
    }],
    aliasImports: [{ alias: "api", path: "acme_runtime::api" }],
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
  assert.deepEqual(semantics.operations[0].resultCarrier, resultCarrier);
});

test("provider path identity distinguishes owners and rejects contradictory exact rows", () => {
  const definitionWithPath = (id, moduleSpecifier, path) => ({
    id,
    displayName: id,
    version: "1.0.0",
    modules: [{
      moduleSpecifier,
      providerModuleId: id,
      exports: [{
        id: `${id}::create`,
        name: "create",
        kind: "function",
        signatures: [{ id: `${id}::create()`, parameters: [], returnType: { kind: "opaque", id: "Shared" } }],
      }],
    }],
    operations: [{
      exportId: `${id}::create`,
      operationKind: "method",
      target: { form: "call", path: `${id.replaceAll("-", "_")}::create` },
      resultCarrier: rustProviderPathTargetType({
        owner: { packageId: id, packageVersion: "1.0.0" },
        itemId: "acme.Shared",
        displayPath: path,
      }),
    }],
    crates: [],
  });

  assert.equal(collectRustProviderSemanticsFromDefinitions([
    definitionWithPath("acme-first", "@acme/first", "acme_first::Shared"),
    definitionWithPath("acme-second", "@acme/second", "acme_second::Shared"),
  ]).operations.length, 2);
  assert.throws(() => mergeRustProviderSemantics(
    collectRustProviderSemanticsFromDefinitions([
      definitionWithPath("acme-shared", "@acme/shared", "acme_shared::Shared"),
    ]),
    collectRustProviderSemanticsFromDefinitions([
      definitionWithPath("acme-shared", "@acme/shared", "other::Shared"),
    ]),
  ), /conflicting definitions/u);
});

test("provider carrier trait guarantees are part of the exact carrier contract", () => {
  const moveOnly = rustProviderPathTargetType({
    owner: { packageId: "acme-shared", packageVersion: "1.0.0" },
    itemId: "acme.Shared",
    displayPath: "acme_shared::Shared",
  });
  const cloneable = rustProviderPathTargetType({
    owner: { packageId: "acme-shared", packageVersion: "1.0.0" },
    itemId: "acme.Shared",
    displayPath: "acme_shared::Shared",
    traitImplementations: [{ trait: rustCloneTrait, requirements: [] }],
  });
  assert.notDeepEqual(moveOnly, cloneable);
});
