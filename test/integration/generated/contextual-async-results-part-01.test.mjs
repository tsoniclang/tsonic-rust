import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { contextualAsyncCostSource, contextualAsyncResultSource, inlineContextualAsyncResultSource, ordinaryAsyncResultSource } from "../../../../tsonic/test/fixtures/contextual-async-results.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { assertRejectedAsyncSource, assertSettledCopiedPromise, verifyNativeBorrowedPromiseBoundary }
  from "../../helpers/native-promise-lifetimes.mjs";

test("native JS async bodies retain contextual union completion, captures, aliases and rejection", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": (contextualAsyncResultSource + "\nawait main();\n") } });
  assert.equal(result.diagnostics.length, 0, "contextual async source has no diagnostics");
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.then\(|\.then_async\(|transmute|unreachable_unchecked/u);
  assert.doesNotMatch(output, /JsPromise<\(\)>[\s\S]{0,100}\.map\(/u);
  const module = result.artifacts.find(artifact => artifact.path === "src/index.rs")?.text;
  assert.equal(typeof module, "string");
  const shapes = result.artifacts.find(artifact => artifact.path === "src/shapes.rs")?.text;
  assert.equal(typeof shapes, "string");
  assert.match(shapes, /#\[derive\(Clone\)\]\n(?:#\[[^\n]+\]\n)*pub\(crate\) enum Union2<Payload0, Payload1> \{\s*Variant0\(Payload0\),\s*Variant1\(Payload1\),\s*\}/u,
    "runtime unions require only their selected Clone contract, not unsolicited payload traits");
  assert.doesNotMatch(shapes, /derive\([^\n]*(?:Debug|PartialEq)/u);
  assert.match(module, /crate::shapes::Union2<\s*js_abi::JsPromise<Option<Reply>>,\s*Reply,?\s*>/u);
  assert.match(module, /JsPromise<Option<Reply>>/u,
    "stored async payloads retain their exact native output");
  validateGeneratedProject("contextual-async-results", result.artifacts, { run: true });
});

test("inline contextual async unions execute after native promise lifetime closure", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": (inlineContextualAsyncResultSource + "\nawait main();\n") } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
  validateGeneratedProject("inline-contextual-async-results", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  test(`ordinary async output stays native and lossless on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": (ordinaryAsyncResultSource + "\nawait main();\n") } });
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
  assert.equal((output.match(/JsPromise::resolved\(/gu) ?? []).length, 1,
    "one exact settled Promise is sufficient for the empty body");
  assert.doesNotMatch(output, /\.then\(|\.then_async\(|JsPromise::from_\w+_factory|\.map\(/u);
  const directory = writeGeneratedProject("contextual-async-cost", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod contextual_async_cost {
    use super::*;
    ${nativeOwnershipCostSupport(directory)}

    type CompletionPromise = js_abi::JsPromise<Option<i32>>;
    type CompletionHandler = rt::Callable<'static, (), Result<CompletionPromise, core::convert::Infallible>>;

    fn handwritten() -> CompletionHandler {
        rt::Callable::new(|()| Ok(js_abi::JsPromise::resolved(None)))
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
  runCargo(directory, ["fmt"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  const executed = runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
  assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
});

for (const [name, body, nativeBody, alias] of [
  ["read", "await pending; return load(value);", "pending.into_result().await?; Ok::<_, js_abi::JsValue>(value)"],
  ["readFirst", "const copied = load(value); await pending; return copied;", "let copied = value; pending.into_result().await?; Ok::<_, js_abi::JsValue>(copied)"],
].flatMap(entry => [false, true].map(alias => [...entry, alias]))) {
  test(`${alias ? "lexical alias" : "direct native"} ${name} adds exactly zero ownership costs against its inlined body`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
async function ${name}<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  ${body}
}
export async function run(pending: Promise<void>): Promise<int32> {
  const value: int32 = 17;
  ${alias ? `const selected = ${name};` : ""}
  return await ${alias ? "selected" : name}(ref(value), pending);
}
` } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const output = result.artifacts.find(artifact => artifact.path === "src/index.rs")?.text;
    assert.equal(typeof output, "string", "the full native borrower/factory pair is emitted");
    assert.equal((output.match(/JsPromise::from_fallible_factory\(/gu) ?? []).length, 1,
      "only run's genuine public object facet constructs a task");
    assert.equal(/Box::pin|'Region: 'static/u.test(output), false, "the borrowed direct body adds no boxed/static adapter");
    const directory = writeGeneratedProject(`${alias ? "lexical-alias" : "direct-native"}-${name}-cost`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod direct_native_cost {
    use super::*;
    ${nativeOwnershipCostSupport(directory)}

    fn handwritten(pending: js_abi::JsPromise<()>) -> js_abi::JsPromise<i32> {
        js_abi::JsPromise::from_fallible_factory(move || async move {
            let value = 17;
            ${nativeBody}
        })
    }

    #[test]
    fn scoped_native_edge_matches_the_inlined_native_cost_and_result() {
        for _ in 0..32 {
            let (actual_value, actual) = measure(|| tsonic_rust_js::event_loop::block_on(async {
                let pending = js_abi::JsPromise::resolved(());
                run(pending).into_result().await.unwrap()
            }).unwrap());
            let (expected_value, expected) = measure(|| tsonic_rust_js::event_loop::block_on(async {
                let pending = js_abi::JsPromise::resolved(());
                handwritten(pending).into_result().await.unwrap()
            }).unwrap());
            assert_eq!(actual_value, 17);
            assert_eq!(expected_value, 17);
            assert_eq!(actual, expected);
            assert_eq!(actual.allocations, actual.deallocations);
            assert_eq!(actual.allocated_bytes, actual.deallocated_bytes);
            assert_eq!(actual.reallocations, 0);
        }
    }
}
`);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["fmt"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const executed = runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
  });
}

test("contextual storage keeps a settled copied payload after its input loan ends", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
async function read<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return load(value); }
export function escape<Region extends Life>(value: Ref<int32, Region>): () => Promise<int32 | void> {
  const pending: Promise<int32> = read(value);
  return async () => await pending;
}
export async function main(): Promise<void> {
  const retained = (() => {
    const value = 17 as int32;
    return escape(ref(value));
  })();
  if (await retained() !== 17 || await retained() !== 17) throw new Error("contextual settled copy");
}
await main();
` } });
  assert.equal(result.diagnostics.length, 0, "the unchanged settled read copies its result before the input scope ends");
  assertSettledCopiedPromise(result, "pending");
  assert.equal(validateGeneratedProject("contextual-async-settled-copy", result.artifacts, { run: true }).status, 0,
    "both retained contextual invocations preserve the copied native value");
});
