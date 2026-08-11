import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRustThroughTargetPack,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("Rust standard-library virtual imports retain exact generic operations", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "bin", crateName: "rust_std_provider_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { HashMap, HashSet } from "@tsonic/rust/std/collections.js";
import { Vec } from "@tsonic/rust/std/vec.js";

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
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /42\.0/u);
  const run = validateGeneratedProject("rust-stdlib-provider", result.artifacts, { run: true });
  assert.equal(run.status, 0);
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
