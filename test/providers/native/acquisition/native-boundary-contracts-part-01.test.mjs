import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { artifactText, compileRustThroughTargetPack, repositoryRoot } from "../../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { spawnGeneratedCargo } from "../../../helpers/cargo-target-pool.mjs";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import {
  createBorrowedProject,
  writeArtifacts,
} from "./native-boundary-contracts-fixtures.mjs";

test("native boxed errors preserve From conversion, user-owned Termination and the unboxed success path", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_boxed_errors" } },
    files: { "index.ts": `
import type { Dyn } from "@tsonic/rust/types.js";
import type { Box } from "@tsonic/rust/std/boxed.js";
import type { Error as NativeError } from "@tsonic/rust/std/error.js";
import { Result } from "@tsonic/rust/core/result.js";
import { read_to_string } from "@tsonic/rust/std/fs.js";
import { propagate } from "@tsonic/rust/lang.js";
type Outcome<T> = Result<T, Box<Dyn<NativeError>>>;
function read(path: string): Outcome<string> {
  return Result.Ok<string, Box<Dyn<NativeError>>>(propagate(read_to_string(path)));
}
export function main(): Outcome<void> {
  propagate(read("fixture.txt"));
  return Result.Ok<void, Box<Dyn<NativeError>>>(undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /Box<dyn (?:std|core)::error::Error>/u);
  assert.match(source, /read_to_string[^;]+\?/u);
  assert.doesNotMatch(source, /TsonicError|TsonicResult|Box::new|\.unwrap\(/u);
  assert.equal(result.artifacts.some(artifact => artifact.path === "src/main.rs"), false);
  assert.match(source, /fn main\(\) -> std::result::Result<\(\), std::boxed::Box<dyn std::error::Error>>/u);
  const root = writeGeneratedProject("native-boxed-errors", result.artifacts);
  writeFileSync(join(root, "src/main.rs"), "fn main() -> Result<(), Box<dyn std::error::Error>> {\n    native_boxed_errors::index::main()\n}\n");
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["build", "--locked", "--offline"]);
  const execution = { cwd: root, encoding: "utf8", timeout: 10_000, binary: "debug/native_boxed_errors" };
  const missing = spawnGeneratedCargo(root, [], execution);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /Error:.*NotFound/u);
  assert.equal(missing.stdout, "");
  writeFileSync(join(root, "fixture.txt"), "native success");
  const success = spawnGeneratedCargo(root, [], execution);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout, "");
  assert.equal(success.stderr, "");
  appendFileSync(join(root, "src/index.rs"), `
#[cfg(test)]
mod native_tests {
    #[test]
    fn success_retains_exact_file_contents() {
        assert_eq!(super::read("fixture.txt".to_owned()).unwrap(), "native success");
    }
}
`);
  runCargo(root, ["test", "--locked", "--offline"]);
});
