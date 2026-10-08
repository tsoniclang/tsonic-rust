import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { contextualAsyncCostSource, contextualAsyncResultSource, inlineContextualAsyncResultSource, ordinaryAsyncResultSource } from "../../../../tsonic/test/fixtures/contextual-async-results.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { verifyNativeBorrowedPromiseBoundary } from "../../helpers/native-promise-lifetimes.mjs";

test("native JS async bodies retain contextual union completion, captures, aliases and rejection", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": contextualAsyncResultSource } });
  assert.equal(result.diagnostics.length, 0, "contextual async source has no diagnostics");
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.then\(|\.then_async\(|transmute|unreachable_unchecked/u);
  assert.doesNotMatch(output, /JsPromise<'static, \(\), rt::TsonicError>[\s\S]{0,100}\.map\(/u);
  const module = result.artifacts.find(artifact => artifact.path === "src/index.rs")?.text;
  assert.equal(typeof module, "string");
  const shapes = result.artifacts.find(artifact => artifact.path === "src/shapes.rs")?.text;
  assert.equal(typeof shapes, "string");
  assert.match(shapes, /#\[derive\(Clone\)\]\n(?:#\[[^\n]+\]\n)*pub\(crate\) enum Union2<Payload0, Payload1> \{\s*Variant0\(Payload0\),\s*Variant1\(Payload1\),\s*\}/u,
    "runtime unions require only their selected Clone contract, not unsolicited payload traits");
  assert.doesNotMatch(shapes, /derive\([^\n]*(?:Debug|PartialEq)/u);
  assert.match(module, /crate::shapes::Union2<\s*js_abi::JsPromise<'static, Option<Reply>, rt::TsonicError>,\s*Reply,?\s*>/u);
  assert.match(module, /JsPromise<'static, Option<Reply>, rt::TsonicError>/u,
    "stored async payloads retain their owning lifetime and exact native output");
  validateGeneratedProject("contextual-async-results", result.artifacts, { run: true });
});

test("inline contextual async unions execute after native promise lifetime closure", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": inlineContextualAsyncResultSource } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
  validateGeneratedProject("inline-contextual-async-results", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  test(`ordinary async output stays native and lossless on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": ordinaryAsyncResultSource } });
    assert.equal(result.diagnostics.length, 0, "ordinary async source has no diagnostics");
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
  assert.equal(result.diagnostics.length, 0, "contextual async cost source has no diagnostics");
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
  assert.deepEqual(result.diagnostics.map(row => row.code).sort(), [
    "RUST_FUTURE_VALUE_CARRIER_CONFLICT", "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
    "RUST_FUTURE_VALUE_CARRIER_CONFLICT", "RUST_FUTURE_VALUE_CARRIER_CONFLICT", "RUST_INITIALIZER_CARRIER_MISMATCH",
  ]);
  assert.equal(result.artifacts.length, 0, "invalid lifetime transport publishes no native output");
  const control = compileRust({ surfaces: ["js"], files: { "index.ts": ordinaryAsyncResultSource } }).result;
  assert.equal(control.diagnostics.length, 0);
  verifyNativeBorrowedPromiseBoundary("contextual-async-borrow-rejected", control.artifacts, true);
});
