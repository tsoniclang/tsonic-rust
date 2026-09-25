import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRustThroughTargetPack } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { rustFormatHasExplicitArguments } from "../../../../dist/analysis/operations/provider/calls/macro-inputs.js";

test("native format data cannot introduce untracked variable captures", () => {
  for (const value of ["{}", "{1} {0:?}", "{{name}}", "{:.2$}", "{:0>6}", "{:#x}", "{:.*}"]) {
    assert.equal(rustFormatHasExplicitArguments(value), true, value);
  }
  for (const value of ["{name}", "{name:?}", "{0:width$}", "{:.precision$}", "{🦀}", "{0:x2$}"]) {
    assert.equal(rustFormatHasExplicitArguments(value), false, value);
  }
});

test("public vector list and repetition macros retain the exact native vector carrier", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_vector_macros" } },
    files: { "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import { vec as list, vecRepeat, Vec } from "@tsonic/rust/std/vec.js";
import { vec as allocated } from "@tsonic/rust/alloc/vec.js";
function identity(value: Vec<int32>): Vec<int32> { return value; }
export function main(): void {
  const empty = list<int32>();
  const values = identity(list<int32>(1, 2, 3));
  const count: nativeUint = 3;
  const copies = vecRepeat<int32>(7, count);
  const inferred = list(2, 3);
  const alias = allocated<int32>(4);
  let calls: int32 = 0;
  const zero = vecRepeat<int32>((++calls), 0);
  const strings = vecRepeat("value", 2);
  if (!empty.is_empty() || values.pop() !== 3 || values.pop() !== 2 || values.pop() !== 1 ||
    copies.pop() !== 7 || copies.pop() !== 7 || copies.pop() !== 7 || !copies.is_empty() ||
    inferred.pop() !== 3 || alias.pop() !== 4 || !zero.is_empty() || calls !== 1 ||
    strings.pop() !== "value" || strings.pop() !== "value") throw new Error("native vector macros");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /std::vec!\[1, 2, 3\]/u);
  assert.match(source, /std::vec!\[7; count\]/u);
  assert.doesNotMatch(source, /JsArray|rest_values|vec_repeat|Vec::from/u);
  validateGeneratedProject("native-vector-macros", result.artifacts, { run: true });
});

test("native formatting borrows checked individual values without erasure or eager conversion", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "bin", crateName: "native_format_macros" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { println as line, eprintln } from "@tsonic/rust/std/index.js";
export function main(): void {
  const message = "native";
  let index: int32 = 0;
  line("{} {} {}", message, ++index, ++index);
  line("{1} {0:04}", index, message);
  line("{{literal}} 🦀");
  eprintln("{}", message);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /std::println!\(/u);
  assert.match(source, /std::eprintln!\(/u);
  assert.doesNotMatch(source, /JsArray|JsValue|format!|message\.clone\(\)|message\.to_string\(\)/u);
  const run = validateGeneratedProject("native-format-macros", result.artifacts, { run: true });
  assert.equal(run.stdout, "native 1 2\nnative 0002\n{literal} 🦀\n");
  assert.match(run.stderr, /native\n/u);
});

test("format macros reject runtime formats and vector source signatures retain checking", () => {
  const { result } = compileRustThroughTargetPack({ files: { "index.ts": `
import { println } from "@tsonic/rust/std/index.js";
export function bad(format: string): void { println(format, 1); }
` } });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_MACRO_FORMAT_LITERAL_REQUIRED"));
  assert.throws(() => compileRustThroughTargetPack({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { vec } from "@tsonic/rust/std/vec.js";
export function bad(): void { vec<int32>("wrong"); }
` } }), /not assignable/u);
});
