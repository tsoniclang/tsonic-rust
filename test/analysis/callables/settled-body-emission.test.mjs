import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

for (const [name, source, helper] of [
  ["direct settled chain", `
    async function leaf(value: number): Promise<number> { return value + 1; }
    export async function outer(): Promise<number> { return await leaf(1); }
  `, "leaf_settled"],
  ["borrowed settled chain", `
    import type { int32 } from "@tsonic/core/types.js";
    import type { Life, Ref } from "@tsonic/rust/types.js";
    import { load } from "@tsonic/rust/lang.js";
    async function sum<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return load(value); }
    export async function outer<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return await sum(value); }
  `, "sum_settled"],
]) {
  test(`${name} emits its preselected helper with no task factory or await`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.deepEqual(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), []);
    const emitted = artifactText(result, "src/index.rs");
    assert.equal(emitted.includes(`fn ${helper}`), true, emitted);
    assert.equal(emitted.includes(".await"), false, emitted);
    assert.equal(emitted.includes("from_fallible_factory") || emitted.includes("from_infallible_factory"), false, emitted);
    assert.equal(emitted.includes("JsPromise::resolved") || emitted.includes("JsPromise::from_result"), true);
    assert.equal(emitted.includes("Box::pin") || emitted.includes("dyn Future"), false);
  });
}
