import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeFilesPackage,
  acmePlatformPackage,
  acmeVectorsPackage,
  artifactText,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";
import { createRustProviderPackage } from "../dist/index.js";
import { collectRustProviderSemantics } from "../dist/source/provider-packages/index.js";

function providerContext(selectedCapabilities) {
  return {
    project: { entryPoint: "src/index.ts", targets: [{ id: "rust" }] },
    projectDirectory: "/src",
    target: { id: "rust", options: {} },
    targetPack: { id: "rust" },
    selectedCapabilities,
    selectedSurfaces: [],
  };
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
  assert.match(artifactText(result, "src/index.rs"), /acme_files::read_text\(path\)/u);
  const manifest = artifactText(result, "Cargo.toml");
  assert.match(manifest, /acme_files = \{ path = ".*acme_files" \}/u);
  assert.match(manifest, /tsonic_rust_runtime = \{ path = /u);
});

test("provider call records selected signature and operation facts by identity", () => {
  const packages = [acmeFilesPackage()];
  const compiled = compileRust({
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
  assert.deepEqual(compiled.result.diagnostics, []);
  const { source, translationContext } = compiled;
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

  const selected = translationContext.facts.getSelectedTargetCall(callNode);
  assert.equal(selected.member.id, "tsonic.rust.provider.10:acme-files47:tsonic.rust.provider-package.acme-files.binding5:1.0.010:acme.files11:@acme/files21:@acme/files::readText");
  assert.equal(selected.providerDeclaration.exportId, "@acme/files::readText");
  const operation = translationContext.facts.getSelectedTargetOperation(callNode);
  assert.equal(operation.operationId, selected.member.id);
  assert.equal(operation.operationKind, "method");
  assert.equal(operation.targetOperation, "acme_files::read_text");
});

test("provider call argument passing facts preserve exact Rust row modes", () => {
  const compiled = compileRust({
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
  assert.deepEqual(compiled.result.diagnostics, []);
  const { source, translationContext } = compiled;
  const { ast } = source;
  const sourceFile = source.sourceFiles.find((file) => ast.getFileName(file) === "/src/index.ts");
  assert.ok(sourceFile);
  const modes = new Map();
  const visit = (node) => {
    if (ast.kindName(node) === "KindCallExpression") {
      const selection = translationContext.facts.getSelectedTargetCall(node);
      const exportId = selection?.providerDeclaration?.exportId;
      if (exportId !== undefined) {
        modes.set(exportId, ast.arguments(node).map((argument) =>
          argument === undefined ? undefined : translationContext.facts.getArgumentPassingFact(argument)?.mode));
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
    crates: [],
  });

  const semantics = collectRustProviderSemantics(providerContext([providerPackage]));
  assert.equal(semantics.operations[0].target.path, "acme_runtime::api::create");
  assert.deepEqual(semantics.operations[0].resultCarrier, {
    kind: "target-specific",
    target: "rust",
    name: "named-type",
    value: {
      id: "acme.materialized.Value",
      path: "acme_runtime::Value",
      typeArguments: [],
    },
  });
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
