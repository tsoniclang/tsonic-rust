import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const tsonicRoot = resolve(repositoryRoot, "../tsonic");
const referenceRoot = resolve(tsonicRoot, "docs/reference/targets/rust");

test("Rust package delegates product documentation to the canonical Tsonic tree", () => {
  const readme = readFileSync(resolve(repositoryRoot, "README.md"), "utf8");
  assert.match(readme, /tsonic\/tree\/main\/docs\/manual\/targets\/rust/u);
  assert.match(readme, /tsonic\/tree\/main\/docs\/reference\/targets\/rust/u);
  assert.equal(existsSync(resolve(repositoryRoot, "docs")), false);
});

test("canonical Rust configuration lists every accepted option", () => {
  const source = readFileSync(resolve(repositoryRoot, "src/options/rust-target-options.ts"), "utf8");
  const reference = readFileSync(resolve(referenceRoot, "configuration.md"), "utf8");
  for (const option of extractFrozenStringList(source, "supportedRustTargetOptionKeys")) {
    assert.match(reference, new RegExp(`\\| \\`${escapeRegExp(option)}\\` \\|`, "u"), option);
  }
});

test("canonical Rust source-module reference lists every public source alias", () => {
  const modules = readFileSync(resolve(repositoryRoot, "src/source/profiles/source-modules.ts"), "utf8");
  const identities = readFileSync(resolve(repositoryRoot, "src/source/semantics/identity.ts"), "utf8");
  const reference = readFileSync(resolve(referenceRoot, "source-modules.md"), "utf8");
  const names = new Set([
    ...[...modules.matchAll(/sourcePrimitive\("([^"]+)"/gu)].map((match) => match[1]),
    ...extractObjectStringValues(identities, "rustSourceTypeExportIds"),
    ...extractObjectStringValues(identities, "rustSourceOperationExportIds"),
    "constPtr",
    "mutPtr",
  ]);
  for (const name of names) {
    assert.ok(reference.includes("`" + name), name);
  }
});

test("support ledgers are test fixtures rather than a second documentation tree", () => {
  assert.equal(existsSync(resolve(repositoryRoot, "test/fixtures/support/csharp-parity-lanes.json")), true);
  assert.equal(existsSync(resolve(repositoryRoot, "test/fixtures/support/javascript-node-lanes.json")), true);
});

function extractFrozenStringList(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`, "u"));
  assert.ok(match?.[1] !== undefined, name);
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

function extractObjectStringValues(source, name) {
  const match = source.match(new RegExp(`${name}[^=]*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\s*as const\\)`, "u"));
  assert.ok(match?.[1] !== undefined, name);
  return [...match[1].matchAll(/:\s*"([^"]+)"/gu)].map((entry) => entry[1]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
