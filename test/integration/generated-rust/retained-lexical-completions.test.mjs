import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { retainedLexicalCompletionsSource } from "../../../../tsonic/test/fixtures/retained-lexical-completions.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("retained lexical completions preserve owning, generic, repeated, mutable and thrown captures", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": retainedLexicalCompletionsSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /transmute|unreachable_unchecked/u);
  validateGeneratedProject("retained-lexical-completions", result.artifacts, { run: true });
});

test("a named retained future keeps the exact enclosing borrowed lifetime", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
export function borrowed<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
  async function read(): Promise<int32> { return load(value); }
  return read();
}
export async function main(): Promise<void> {
  const value = 29 as int32;
  if (await borrowed(ref(value)) !== 29) throw new Error("retained native loan");
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn read<'Region>\(capture: &'Region i32\) -> js_abi::JsPromise<'Region, i32, rt::TsonicError>/u);
  assert.doesNotMatch(source, /transmute|Box<dyn|Location/u);
  validateGeneratedProject("retained-lexical-native-loan", result.artifacts, { run: true });
});

test("an owned lexical future matches handwritten move, allocation and release costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": retainedLexicalCompletionsSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const directory = writeGeneratedProject("retained-lexical-capture-cost", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod retained_lexical_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    fn handwritten(value: String) -> js_abi::JsPromise<'static, String, rt::TsonicError> {
        js_abi::JsPromise::from_infallible_factory(move || async move { value })
    }

    #[test]
    fn owning_capture_moves_once_and_releases_every_owner() {
        for _ in 0..32 {
            for execute in [false, true] {
                let (actual_length, actual) = measure(|| {
                    let value = String::from(std::hint::black_box("owned retained capture"));
                    let pending = owned(value);
                    if execute {
                        let value = rt::block_on(pending.into_result()).unwrap();
                        let length = std::hint::black_box(&value).len();
                        drop(value);
                        length
                    } else {
                        std::hint::black_box(&pending);
                        drop(pending);
                        0
                    }
                });
                let (expected_length, expected) = measure(|| {
                    let value = String::from(std::hint::black_box("owned retained capture"));
                    let pending = handwritten(value);
                    if execute {
                        let value = rt::block_on(pending.into_result()).unwrap();
                        let length = std::hint::black_box(&value).len();
                        drop(value);
                        length
                    } else {
                        std::hint::black_box(&pending);
                        drop(pending);
                        0
                    }
                });
                assert_eq!(actual_length, expected_length);
                assert_eq!(actual, expected);
                assert_eq!(actual.allocations, actual.deallocations);
                assert_eq!(actual.allocated_bytes, actual.deallocated_bytes);
                assert_eq!(actual.reallocations, 0);
            }
        }
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
});
