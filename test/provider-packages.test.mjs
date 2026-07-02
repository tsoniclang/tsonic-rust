import { test } from "node:test";
import assert from "node:assert/strict";
import { selectedTargetSignatureFactKey, targetOperationFactKey } from "@tsonic/tsts";
import {
  acmeFilesPackage,
  acmePlatformPackage,
  artifactText,
  compileRust,
  createRustSession,
  checkRustSession,
} from "./helpers/rust-session.mjs";

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
  const harness = createRustSession({
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
  const extensionHost = checkRustSession(harness);
  const { ast } = harness.session;
  const sourceFile = harness.session.getSourceFile("/src/index.ts");
  let callNode;
  const visit = (node) => {
    if (ast.kindName(node) === "KindCallExpression") {
      callNode = node;
    }
    ast.forEachChild(node, (child) => child && visit(child));
  };
  visit(sourceFile);

  const selected = extensionHost.facts.get(callNode, selectedTargetSignatureFactKey);
  assert.equal(selected.member.id, "@acme/files::readText");
  assert.equal(selected.providerDeclaration.exportId, "@acme/files::readText");
  const operation = extensionHost.facts.get(callNode, targetOperationFactKey);
  assert.equal(operation.operationKind, "method");
  assert.equal(operation.targetOperation, "acme_files::read_text");
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

test("unmapped provider operation fails closed with extension and backend diagnostics", () => {
  const packageWithoutRows = acmePlatformPackage();
  const strippedPackage = {
    ...packageWithoutRows,
    rustProviderOperations: () => packageWithoutRows.rustProviderOperations().filter((row) => row.memberId !== "@acme/platform::Env.homeDir"),
  };
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
  const extensionHost = checkRustSession(harness);
  const extensionDiagnostics = extensionHost.diagnostics.all();
  assert.ok(extensionDiagnostics.some((diagnostic) =>
    diagnostic.extensionCode === "RUST_PROVIDER_OPERATION_NOT_MAPPED" &&
    diagnostic.message.includes("@acme/platform::Env.homeDir")));
});

test("provider property backend lowering fails closed without a mapped fact", () => {
  const packageWithoutRows = acmePlatformPackage();
  const strippedPackage = {
    ...packageWithoutRows,
    rustProviderOperations: () => [],
  };
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

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
});

test("provider packages contribute cargo path dependencies through runtime contributions", () => {
  const acmeFiles = acmeFilesPackage();
  const contributions = acmeFiles.runtimeContributions({});
  assert.equal(contributions.references.length, 1);
  assert.equal(contributions.references[0].kind, "cargo-path");
  assert.equal(contributions.references[0].attributes.crate, "acme_files");
});
