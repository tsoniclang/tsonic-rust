import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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

export function selectUsed(unusedValue: int32, usedValue: int32): int32 {
  return usedValue;
}

export function preserveCollision(_value: int32, value: int32): int32 {
  return _value;
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
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub struct BuildResultState \{\s*pub output_dir: String,\s*pub pages_built: i32,/u);
  assert.match(source, /pub struct BuildResult/u);
  assert.match(source, /#\[doc\(hidden\)\]\s*pub state: rt::ObjectRef<BuildResultState>/u);
  assert.match(source, /pub fn page_label\([^)]*prefix_text: String/u);
  assert.match(source, /pub fn build_site\(site_dir: String\) -> BuildResult/u);
  assert.match(source, /pub fn select_used\(_unused_value: i32, used_value: i32\) -> i32/u);
  assert.match(source, /pub fn preserve_collision\(_value: i32, _value_2: i32\) -> i32/u);
  assert.match(source, /build_site\(String::from\("site"\)\)\.page_label/u);
  assert.doesNotMatch(source, /\b(?:currentValue|outputDir|pagesBuilt|pageLabel|prefixText|buildSite|siteDir)\b/u);
  assert.doesNotMatch(source, /__tsonic_state|state\.\d/u);
  assert.doesNotMatch(source, /^#!\[allow\(/mu);
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

test("generic state retains exact type identity even when authored fields do not mention it", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "clean_generic_state" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class Marker<T> {
  label: string;

  constructor(label: string) {
    this.label = label;
  }
}

export function main(): void {
  const marker = new Marker<int32>("ready");
  marker.label;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /struct Marker<T: Clone> \{/u);
  assert.doesNotMatch(source, /T: Clone \+ 'static/u);
  assert.match(source, /type_marker: std::marker::PhantomData<\(T,\)>/u);
  assert.match(source, /pub\(crate\) label: String,/u);
  assert.doesNotMatch(source, /ObjectHandle|ObjectRef/u);
  assert.match(source, /type_marker: std::marker::PhantomData/u);
  assert.match(source, /Marker::<i32>::new\(String::from\("ready"\)\)/u);
  assert.doesNotMatch(source, /Marker::new::<i32>/u);
  validateGeneratedProject("clean-generic-state", result.artifacts);
});

test("structural shapes have one exact readable crate-wide identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "lib", crateName: "clean_structural_shapes" } },
    files: {
      "shapes.ts": `
export function authoredShapesModule(): string { return "authored"; }
`,
      "producer.ts": `
export function makeEntry() {
  return { outputDir: "site", pagesBuilt: 1 };
}

export function makeNested() {
  return { entry: makeEntry() };
}

export function makeNumericValue() {
  return { value: 1 };
}

export function makeTextValue() {
  return { value: "one" };
}

export function makeCollidingFields() {
  return { fooBar: 1, foo_bar: 2 };
}
`,
      "consumer.ts": `
import { makeEntry, makeNested } from "./producer.js";

export function readEntry(): string {
  return makeEntry().outputDir + makeNested().entry.outputDir;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/lib.rs"), /#\[doc\(hidden\)\]\npub mod shapes_2;/u);
  const shapes = artifactText(result, "src/shapes_2.rs");
  assert.match(shapes, /pub struct OutputDirPagesBuiltShape \{/u);
  assert.match(shapes, /pub output_dir: String,/u);
  assert.match(shapes, /pub pages_built: f64,/u);
  assert.match(shapes, /pub struct EntryShape \{/u);
  assert.match(
    shapes,
    /pub entry: rt::ObjectHandle<OutputDirPagesBuiltShape>,/u,
  );
  assert.match(shapes, /pub struct ValueShape \{/u);
  assert.match(shapes, /pub struct ValueShape2 \{/u);
  assert.match(shapes, /pub struct FooBarFooBarShape \{\s*pub foo_bar: f64,\s*pub foo_bar_2: f64,/u);
  const producer = artifactText(result, "src/producer.rs");
  const consumer = artifactText(result, "src/consumer.rs");
  assert.match(producer, /crate::shapes_2::OutputDirPagesBuiltShape/u);
  assert.match(consumer, /crate::producer::make_entry\(\)\.with\(\|state\| state\.output_dir\.clone\(\)\)/u);
  assert.doesNotMatch(`${shapes}\n${producer}\n${consumer}`, /ObjectHandle<\(/u);
  assert.doesNotMatch(`${shapes}\n${producer}\n${consumer}`, /state\.\d/u);
  validateGeneratedProject("clean-structural-shapes", result.artifacts);
});
