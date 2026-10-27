import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRustThroughTargetPack } from "../../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("native Result exports support user-owned Termination startup without an additional error carrier", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_result_entry" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Result } from "@tsonic/rust/core/result.js";
import { propagate } from "@tsonic/rust/lang.js";
function value(): Result<int32, int32> { return Result.Ok<int32, int32>(4); }
export function main(): Result<void, int32> {
  propagate(value());
  return Result.Ok<void, int32>(undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.equal(result.artifacts.some(artifact => artifact.path === "src/main.rs"), false);
  assert.match(output, /fn main\(\) -> std::result::Result<\(\), i32>/u);
  assert.doesNotMatch(output, /TsonicError|TsonicResult|Box::|panic!|unwrap\(/u);
  const nativeDriver = "fn main() -> Result<(), i32> {\n    native_result_entry::index::main()\n}\n";
  validateGeneratedProject("native-result-entry", [...result.artifacts, { path: "src/main.rs", text: nativeDriver }], { run: true });
});

test("native propagation rejects non-Result enclosing returns before emission", () => {
  const { result } = compileRustThroughTargetPack({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Result } from "@tsonic/rust/core/result.js";
import { propagate } from "@tsonic/rust/lang.js";
export function invalid(value: Result<int32, int32>): int32 { return propagate(value); }
` } });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NATIVE_CONTROL_CONTRACT_REQUIRED"));
});
