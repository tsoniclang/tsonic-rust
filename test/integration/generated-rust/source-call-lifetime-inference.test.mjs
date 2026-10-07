import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("source calls infer named lifetime arguments from borrowed inputs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
function identity<Region extends Life, Value>(value: Ref<Value, Region>): Ref<Value, Region> { return value; }
function read<Region extends Life>(value: Ref<int32, Region>): int32 { return load(value); }
function sum<Region extends Life>(left: Ref<int32, Region>, right: Ref<int32, Region>): int32 { return load(left) + load(right); }
async function suspended<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return load(value); }
async function forward<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
  return await suspended(identity(value)) + sum(value, value) + read(value);
}
export async function main(): Promise<void> {
  const value: int32 = 7;
  if (await forward(ref(value)) !== 28) throw new Error("borrowed inference");
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("source-call-lifetime-inference", result.artifacts, { run: true });
});
