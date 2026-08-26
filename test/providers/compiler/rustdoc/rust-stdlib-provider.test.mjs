import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRustThroughTargetPack,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("Rust standard-library virtual imports retain exact generic operations", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "bin", crateName: "rust_std_provider_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { HashMap, HashSet } from "@tsonic/rust/std/collections.js";
import { Vec } from "@tsonic/rust/std/vec.js";
import { Vec as AllocVec } from "@tsonic/rust/alloc/vec.js";

function retainPublicAlias(value: AllocVec<int32>): Vec<int32> {
  return value;
}

export function main(): void {
  const map = new HashMap<string, int32>();
  map.insert("answer", 42);
  if (map.is_empty()) {
    throw new Error("HashMap insertion mismatch");
  }
  map.clear();
  if (!map.is_empty()) {
    throw new Error("HashMap clear mismatch");
  }

  const set = new HashSet<int32>();
  if (!set.insert(7) || set.is_empty()) {
    throw new Error("HashSet insertion mismatch");
  }

  const values = new Vec<int32>();
  values.push(3);
  const value = values.pop();
  if (value !== 3 || !values.is_empty()) {
    throw new Error("Vec operation mismatch");
  }

  const aliasValues = new AllocVec<int32>();
  const retainedAliasValues = retainPublicAlias(aliasValues);
  retainedAliasValues.push(5);
  if (retainedAliasValues.pop() !== 5) {
    throw new Error("standard-library re-export identity mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /42\.0/u);
  assert.doesNotMatch(source, /alloc::vec::Vec/u);
  assert.doesNotMatch(source, /std::alloc::Global/u);
  assert.doesNotMatch(source, /RandomState/u);
  const run = validateGeneratedProject("rust-stdlib-provider", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("Rust standard-library operation requirements reject unsupported native traits", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    files: {
      "index.ts": `
import type { float64, int32 } from "@tsonic/core/types.js";
import { HashMap } from "@tsonic/rust/std/collections.js";

export function invalid(): void {
  const map = new HashMap<float64, int32>();
  map.insert(1, 2);
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN"), JSON.stringify(result.diagnostics));
});

test("Rust standard-library generic arguments fail at source checking, not target fallback", () => {
  assert.throws(
    () => compileRustThroughTargetPack({
      files: {
        "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { HashMap } from "@tsonic/rust/std/collections.js";

export function invalid(): void {
  const map = new HashMap<string, int32>();
  map.insert(1, "wrong");
}
`,
      },
    }),
    /Argument of type 'number' is not assignable to parameter of type 'string'/u,
  );
});

test("Rust standard-library provider materializes requested exports beyond the former catalog", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "bin", crateName: "rust_std_breadth_proof" } },
    files: {
      "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import { size_of } from "@tsonic/rust/std/mem.js";
import { PathBuf } from "@tsonic/rust/std/path.js";

export function main(): void {
  const path = new PathBuf();
  const bytes: nativeUint = size_of<int32>();
  if (bytes === 0 || path.capacity() !== 0) {
    throw new Error("compiler-backed standard-library breadth mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /std::path::PathBuf::new\(\)/u);
  assert.match(source, /std::mem::size_of::<i32>\(\)/u);
  const run = validateGeneratedProject("rust-stdlib-provider-breadth", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
