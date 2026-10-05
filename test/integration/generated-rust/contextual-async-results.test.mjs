import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { contextualAsyncCostSource, contextualAsyncResultSource, ordinaryAsyncResultSource } from "../../fixtures/contextual-async-results.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("native JS async bodies retain contextual union completion, captures, aliases and rejection", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": contextualAsyncResultSource } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.then\(|\.then_async\(|transmute|unreachable_unchecked/u);
  assert.doesNotMatch(output, /JsPromise<'static, \(\), rt::TsonicError>[\s\S]{0,100}\.map\(/u);
  validateGeneratedProject("contextual-async-results", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  test(`ordinary async output stays native and lossless on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": ordinaryAsyncResultSource } });
    assert.deepEqual(result.diagnostics, []);
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /\bi64\b/u);
    assert.doesNotMatch(output, /\bBigInt\b|as f64|dyn Future/u);
    if (surfaces.length === 0) assert.doesNotMatch(output, /JsPromise|Box::pin/u);
    validateGeneratedProject(`ordinary-async-results-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("contextual async output construction costs exactly one native promise without a mapping owner", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": contextualAsyncCostSource } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.equal((output.match(/JsPromise::from_infallible_factory\(/gu) ?? []).length, 1);
  assert.doesNotMatch(output, /\.then\(|\.then_async\(|JsPromise::resolved|\.map\(/u);
  const directory = writeGeneratedProject("contextual-async-cost", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod contextual_async_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    type CompletionPromise = js_abi::JsPromise<'static, Option<i32>, rt::TsonicError>;
    type CompletionHandler = rt::Callable<(), Result<CompletionPromise, rt::TsonicError>>;

    fn handwritten() -> CompletionHandler {
        rt::Callable::new(|()| Ok(js_abi::JsPromise::from_infallible_factory(|| async { None })))
    }

    #[test]
    fn selected_output_adds_no_mapping_allocations_and_releases_every_owner() {
        for _ in 0..32 {
            let (_, actual) = measure(|| {
                let handler = makeEmpty();
                let promise = handler.call(()).unwrap();
                std::hint::black_box(&promise);
                drop(promise);
                drop(handler);
            });
            let (_, expected) = measure(|| {
                let handler = handwritten();
                let promise = handler.call(()).unwrap();
                std::hint::black_box(&promise);
                drop(promise);
                drop(handler);
            });
            assert_eq!(actual, expected);
            assert_eq!(actual.allocations, actual.deallocations);
            assert_eq!(actual.allocated_bytes, actual.deallocated_bytes);
            assert_eq!(actual.reallocations, 0);
        }
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  const executed = runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
  assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
});

test("contextual async output selection cannot extend a borrowed capture to owning native storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
async function read<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return load(value); }
export function escape<Region extends Life>(value: Ref<int32, Region>): () => Promise<int32 | void> {
  const pending: Promise<int32> = read(value);
  return async () => await pending;
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /transmute|unreachable_unchecked|\.then\(|\.then_async\(/u);
  const project = writeGeneratedProject("contextual-async-borrow-rejected", result.artifacts);
  runCargo(project, ["generate-lockfile", "--offline"]);
  assert.throws(() => runCargo(project, ["check", "--all-targets", "--locked", "--offline"]),
    /(?:borrowed data escapes|lifetime may not live long enough)/u);
});
