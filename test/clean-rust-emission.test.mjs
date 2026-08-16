import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("authored declarations use one exact idiomatic Rust name plan", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "clean_rust_names" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

const currentValue: int32 = 40;

export class BuildResult {
  outputDir: string;
  pagesBuilt: int32;

  constructor(outputDir: string, pagesBuilt: int32) {
    this.outputDir = outputDir;
    this.pagesBuilt = pagesBuilt;
  }

  pageLabel(prefixText: string): string {
    return prefixText + this.outputDir;
  }
}

export function buildSite(siteDir: string): BuildResult {
  return new BuildResult(siteDir, currentValue);
}

export function main(): void {
  buildSite("site").pageLabel("built: ");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /const CURRENT_VALUE: i32 = 40;/u);
  assert.match(source, /pub struct BuildResult/u);
  assert.match(source, /pub fn page_label\([^)]*prefix_text: String/u);
  assert.match(source, /pub fn build_site\(site_dir: String\) -> BuildResult/u);
  assert.match(source, /build_site\(String::from\("site"\)\)\.page_label/u);
  assert.doesNotMatch(source, /\b(?:currentValue|outputDir|pagesBuilt|pageLabel|prefixText|buildSite|siteDir)\b/u);
  validateGeneratedProject("clean-rust-names", result.artifacts);
});

test("target-name collisions are local, stable, and referenced by declaration identity", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function fooBar(): int32 { return 20; }
export function foo_bar(): int32 { return 22; }
export function totalValue(): int32 { return fooBar() + foo_bar(); }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn foo_bar_2\(\) -> i32/u);
  assert.match(source, /pub fn foo_bar\(\) -> i32/u);
  assert.match(source, /pub fn total_value\(\) -> i32 \{\s*foo_bar_2\(\) \+ foo_bar\(\)/u);
});
