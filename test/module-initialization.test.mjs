import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("binary module initialization preserves dependency and source evaluation order", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "module_order_proof" },
    },
    files: {
      "state.ts": `
import type { int32 } from "@tsonic/core/types.js";

let sequence: int32 = 1;
sequence += 1;

export function next(): int32 {
  sequence += 1;
  return sequence;
}
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { next } from "./state.js";

export const first: int32 = next();
export let second: int32 = first + 1, third: int32 = second + 1;
third += 1;

export function main(): void {
  if (first !== 3 || second !== 4 || third !== 6) {
    throw new Error("module evaluation order mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const main = artifactText(result, "src/main.rs");
  assert.equal(
    main.indexOf("module_order_proof::state::__tsonic_module_init()") <
      main.indexOf("module_order_proof::index::__tsonic_module_init()"),
    true,
  );
  const index = artifactText(result, "src/index.rs");
  const initializationBody = index.slice(index.indexOf("pub fn __tsonic_module_init"));
  const firstInitialization = initializationBody.indexOf("crate::state::next()");
  const secondInitialization = initializationBody.indexOf("first.with(");
  const thirdInitialization = initializationBody.indexOf("second.with(");
  const finalWrite = initializationBody.indexOf(".update_with(");
  assert.equal(firstInitialization >= 0, true);
  assert.equal(firstInitialization < secondInitialization, true);
  assert.equal(secondInitialization < thirdInitialization, true);
  assert.equal(thirdInitialization < finalWrite, true);
  validateGeneratedProject("module-order-proof", result.artifacts, { run: true });
});

test("runtime module cycles fail before Rust publication", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "module_cycle_rejection" },
    },
    files: {
      "a.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromB } from "./b.js";

export function fromA(): int32 {
  return fromB();
}
`,
      "b.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromA } from "./a.js";

export function fromB(): int32 {
  return fromA();
}
`,
      "index.ts": `
import { fromA } from "./a.js";

export function main(): void {
  fromA();
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(
    result.diagnostics.filter((diagnostic) =>
      diagnostic.code === "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE").length,
    1,
  );
});

test("top-level await runs before the binary entry function", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "async_module_proof" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

async function load(): Promise<int32> {
  return 7;
}

export let value: int32 = await load();

export function main(): void {
  if (value !== 7) {
    throw new Error("async module initialization mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /pub async fn __tsonic_module_init\(\)[\s\S]*?let __tsonic_module_value_\d+ = load\(\)\.await;[\s\S]*?\.initialize\(__tsonic_module_value_\d+\)/u,
  );
  assert.match(
    artifactText(result, "src/main.rs"),
    /tsonic_rust_runtime::block_on\(async_module_proof::index::__tsonic_module_init\(\)\)/u,
  );
  validateGeneratedProject("async-module-proof", result.artifacts, { run: true });
});

test("fallible top-level operations propagate through binary startup", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "fallible_module_proof" },
    },
    files: {
      "index.ts": `
export let value: unknown = JSON.parse("1");

export function main(): void {}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /pub fn __tsonic_module_init\(\) -> rt::TsonicResult<\(\)>[\s\S]*?json_parse\("1"\)\?/u,
  );
  assert.match(
    artifactText(result, "src/main.rs"),
    /fallible_module_proof::index::__tsonic_module_init\(\)\?;/u,
  );
  validateGeneratedProject("fallible-module-proof", result.artifacts, { run: true });
});
