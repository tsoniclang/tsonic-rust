import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustFoundationForPath, rustFoundationForSelectedCall } from "../../../dist/analysis/foundation/requirements.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";

test("selected static calls retain their owning carrier's native foundation", () => {
  const member = { id: "owner.create", sourceName: "create", targetName: "create", kind: "method", parameters: [],
    returnType: { kind: "source-primitive", name: "int32" } };
  assert.equal(rustFoundationForSelectedCall({ member }), "core");
  assert.equal(rustFoundationForSelectedCall({ member, sourceSelectedOwnerCarrier: rustStringTargetType() }), "alloc");
});

test("nonfallible completion is core while error and suppression helpers require alloc", () => {
  for (const root of ["rt", "tsonic_rust_runtime"]) {
    for (const member of ["Completion", "Completion::Normal", "Completion::Return", "Completion::Break", "Completion::Continue"])
      assert.equal(rustFoundationForPath(`${root}::${member}`), "core", member);
    for (const member of ["finish_finally", "finish_resource", "TsonicResult", "TsonicError"])
      assert.equal(rustFoundationForPath(`${root}::${member}`), "alloc", member);
  }
});

test("core cleanup retains initialized native locals without an allocation dependency", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { foundation: "core" } }, files: {
    "index.ts": `export function choose(): number { let value: number; try {} finally { value = 7; } return value; }`,
  } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 3).map(row => row.message.slice(0, 256)).join("\n"));
  assert.match(artifactText(result, "src/lib.rs"), /#!\[no_std\]/u);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\b(?:alloc|std)::|completion_region/u);
  validateGeneratedProject("foundation-core-cleanup", result.artifacts);
});

test("core foundation emits and builds a no-std primitive library", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "core" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function add(left: int32, right: int32): int32 {
  return left + right;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/lib.rs"), /#!\[no_std\]/u);
  assert.doesNotMatch(
    result.artifacts.filter((artifact) => artifact.language === "rust")
      .map((artifact) => artifact.text).join("\n"),
    /\b(?:alloc|std)::/u,
  );
  validateGeneratedProject("foundation-core-primitive", result.artifacts);
});

test("alloc foundation emits and builds native owned strings", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    files: {
      "index.ts": `
export function greet(name: string): string {
  return "hello, " + name;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/lib.rs"), /#!\[no_std\][\s\S]*extern crate alloc;/u);
  assert.match(artifactText(result, "Cargo.toml"), /features = \["alloc"\]/u);
  validateGeneratedProject("foundation-alloc-string", result.artifacts);
});

test("core foundation rejects an alloc carrier before publication", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "core" } },
    files: {
      "index.ts": `
export function greet(name: string): string {
  return name;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED");
  assert.match(result.diagnostics[0].message, /requires Rust 'alloc'.*selected 'core'/u);
});

test("the JavaScript surface requires std explicitly", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    surfaces: ["js"],
    files: { "index.ts": "export const answer = 42;" },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics[0].code, "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED");
});

test("alloc standard-library imports retain alloc-native target paths", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    files: {
      "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import { Vec } from "@tsonic/rust/alloc/vec.js";

export function length(values: Vec<int32>): nativeUint {
  return values.len();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /alloc::vec::Vec<i32>/u);
  assert.doesNotMatch(source, /std::/u);
  validateGeneratedProject("foundation-alloc-provider", result.artifacts);
});
