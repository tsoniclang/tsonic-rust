import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = join(repositoryRoot, "src");

function collectFiles(root, extension) {
  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (fullPath.endsWith(extension)) {
        results.push(fullPath);
      }
    }
  };
  visit(root);
  return results;
}

const sourceFiles = collectFiles(sourceRoot, ".ts").map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

test("no internal TSTS imports", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /from "@tsonic\/tsts\/.+"/u, `${path} imports a deep tsts path`);
    assert.doesNotMatch(text, /dist\/src\/internal/u, `${path} references tsts internals`);
  }
});

test("no source-name target guessing in the backend", () => {
  const bannedTokens = ['"node:', '"@acme', "readText", "readFileSync", '"homeDir"', '"Math"', '"console"', '"push"', '"readFile"'];
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    for (const token of bannedTokens) {
      assert.ok(!text.includes(token), `${path} contains banned source-name token ${token}`);
    }
  }
});

test("no C# target references in Rust target code", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /csharp|roslyn|dotnet/iu, `${path} references the C# target`);
  }
});

test("no embedded JS engine or runtime interpretation dependencies", () => {
  const packageJson = readFileSync(join(repositoryRoot, "package.json"), "utf8");
  const banned = /quickjs|rquickjs|boa_engine|deno_core|"v8"/iu;
  assert.doesNotMatch(packageJson, banned);
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, banned, `${path} references an embedded JS engine`);
  }
});

test("no runtime crate code inside tsonic-rust", () => {
  const rustFiles = collectFiles(sourceRoot, ".rs");
  assert.deepEqual(rustFiles, [], "tsonic-rust src must not contain Rust runtime sources");
  assert.throws(() => statSync(join(repositoryRoot, "crates")), /ENOENT/u);
});

test("no product dependency on analysis files", () => {
  for (const { path, text } of sourceFiles) {
    assert.ok(!text.includes(".analysis/") && !text.includes('".analysis"'), `${path} references .analysis`);
  }
});

test("no Node-as-surface registration", async () => {
  const { createRustTargetPack } = await import("../../dist/index.js");
  const pack = createRustTargetPack();
  for (const surface of pack.surfaces ?? []) {
    assert.notEqual(surface.id, "node");
    assert.notEqual(surface.id, "nodejs");
  }
});

test("no fallback source emission: backend diagnostics never coexist with artifacts", () => {
  // Structural rule enforced in planRustArtifacts: every early return with
  // diagnostics returns an empty artifact list. Verified behaviorally in the
  // negative-lane tests; here we pin the source pattern.
  const plannerText = readFileSync(join(sourceRoot, "backend/planner/rust-planner.ts"), "utf8");
  assert.match(plannerText, /if \(diagnostics\.length > 0\) \{\s*return \{ artifacts: \[\], diagnostics \};/u);
});

test("JS operation rows are unique per owner/member/kind/lane", async () => {
  const source = readFileSync(join(sourceRoot, "source/rust-target-semantics/js-surface-operations.ts"), "utf8");
  const rowPattern = /owner: "([^"]+)", member: "([^"]+)", operationKind: "([^"]+)", lane: "([^"]+)"/gu;
  const seen = new Set();
  let match;
  while ((match = rowPattern.exec(source)) !== null) {
    const key = match.slice(1, 5).join("|");
    assert.ok(!seen.has(key), `duplicate JS operation row: ${key}`);
    seen.add(key);
  }
  assert.ok(seen.size > 20, "row scan should see the operation table");
});

test("rust target product source has no NodeJS capability coupling", () => {
  const forbidden = [/tsonic_rust_node/u, /rust\.node\./u, /createRustNodejsProviderPackage/u, /\bnodejs\b/iu, /"node:(?:fs|os|path|url|crypto|util|buffer|process)/u];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) {
        continue;
      }
      // The compiler's own platform imports (from "node:path") are the
      // build platform, not target knowledge.
      const text = readFileSync(full, "utf8").replace(/from "node:[a-z/]+"/gu, "");
      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          offenders.push(`${full}: ${String(pattern)}`);
        }
      }
    }
  };
  walk(sourceRoot);
  assert.deepEqual(offenders, []);
});

test("provider and library identity never flows through local-name recasing", () => {
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const providerLowering = expressions.slice(
    expressions.indexOf("function refShape"),
    expressions.indexOf("function planCallExpression"),
  );
  assert.ok(providerLowering.includes("function planProviderOperationExpression"), "slice covers provider lowering");
  assert.ok(!providerLowering.includes("rustLocalBindingName"), "provider operation lowering must emit row metadata verbatim");
  for (const file of ["source/rust-target-semantics/js-surface-operations.ts", "source/provider-packages/index.ts"]) {
    const text = readFileSync(join(sourceRoot, file), "utf8");
    assert.ok(!text.includes("rustLocalBindingName"), `${file} must not recase identities`);
  }
});
