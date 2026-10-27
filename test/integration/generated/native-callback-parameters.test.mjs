import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeCallbackParametersSource } from "../../../../tsonic/test/fixtures/native-callback-parameters.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native callbacks retain explicit local arithmetic (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_parameters" } },
      files: { "index.ts": (nativeCallbackParametersSource + "\nmain();\n") } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /let mut value: f64 = /u);
    assert.doesNotMatch(output, /Box::new\([^)]*value|u8_to_f64\(.*u8_to_f64/u);
    validateGeneratedProject(`native-callback-parameters-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`higher-order callbacks preserve distinct aggregate member implementations (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "native_projected_callback_errors" } },
      files: { "index.ts": `
type Box = { readonly callback: () => number; readonly other: (value: number) => number };
function invoke(value: Box): number { return value.callback() + value.other(3); }
function apply(operation: (value: Box) => number, value: Box): number { return operation(value); }
export function run(): number { return apply(invoke, { callback: () => 7, other: value => value }); }
if (run() !== 10) throw "wrong projected callback implementation";
` } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`native-projected-callback-errors-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("Map and Set callbacks preserve their native generic invocation error without erasure", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_collection_callback_errors" } },
    files: { "index.ts": `
function visitMap(entries: Map<number, number>, invoke: (value: number) => void): void {
  entries.forEach(value => { invoke(value); });
}
function visitSet(values: Set<number>, invoke: (value: number) => void): void {
  values.forEach(value => { invoke(value); });
}
function acceptMap(value: number): void { if (value !== 7) throw new Error("map value"); }
function acceptSet(value: number): void { if (value !== 5) throw new Error("set value"); }
export function main(): void {
  const entries = new Map<number, number>();
  entries.set(3, 7);
  const values = new Set<number>();
  values.add(5);
  visitMap(entries, acceptMap);
  visitSet(values, acceptSet);
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.equal((source.match(/\.try_for_each_value\(/gu) ?? []).length, 2);
  assert.doesNotMatch(source, /Box::new|rt::Callable::new/u, "synchronous native callbacks require no erased callable allocation");
  validateGeneratedProject("native-collection-callback-errors", result.artifacts, { run: true });
});

test("intrinsically fallible native helpers preserve pure callback and independent error contracts", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_intrinsic_callback_errors" } },
    files: { "index.ts": `
export function sum(values: number[]): number {
  return values.reduce((left, right) => left + right);
}
function reject(values: number[]): number {
  return values.reduce((_left, _right) => { throw new Error("callback failure"); });
}
export function main(): void {
  if (sum([1, 2]) !== 3) throw new Error("pure callback result");
  let emptyRejected = false;
  try { sum([]); } catch { emptyRejected = true; }
  if (!emptyRejected) throw new Error("missing intrinsic empty-array failure");
  let callbackRejected = false;
  try { reject([1, 2]); } catch { callbackRejected = true; }
  if (!callbackRejected) throw new Error("missing callback failure");
  const pattern = new RegExp("a", "g");
  if ("aa".replace(pattern, () => "b") !== "bb") throw new Error("pure replacement");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /\.reduce_from_first\(/u);
  assert.match(source, /\.try_reduce_from_first\(/u);
  assert.doesNotMatch(source, /Box::new|rt::Callable::new/u, "native synchronous callbacks require no erased allocation");
  validateGeneratedProject("native-intrinsic-callback-errors", result.artifacts, { run: true });
});

test("native replacement adapters preserve projected arguments, callback errors and exact effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_replacement_adapter" } },
    files: { "index.ts": `
export function main(): void {
  let calls = 0;
  const changed = "aa".replace(new RegExp("a", "g"), (matched: string): string => {
    calls += 1;
    return matched + "!";
  });
  const successfulCalls = calls;
  if (changed !== "a!a!" || successfulCalls !== 2) throw new Error("replacement projection or effects");
  let rejected = false;
  try {
    "aa".replace(new RegExp("a", "g"), (_matched: string): string => {
      calls += 1;
      throw new Error("replacement callback failure");
    });
  } catch { rejected = true; }
  if (!rejected || calls !== 3) throw new Error("replacement callback error or repeated effects");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /Box::new|rt::Callable::new/u,
    "native replacement adapters retain ordinary closures without erased allocation");
  validateGeneratedProject("native-replacement-adapter", result.artifacts, { run: true });
});

test("native callbacks reject implicit precision loss from wide integers", () => {
  const { result } = compileRust({ files: { "index.ts": `
import type { nativeUint } from "@tsonic/core/types.js";
function consume(action: (value: nativeUint) => number, value: nativeUint): number { return action(value); }
export function example(value: nativeUint): number { return consume((input: number): number => input, value); }
` } });
  assert.notEqual(result.diagnostics.length, 0);
  assert.deepEqual(result.artifacts, []);
});

test("native array parameters own retained values and borrow nonescaping reads and writes", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: "native_array_parameters" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
class Box {
  values: int32[];
  constructor(values: int32[]) { this.values = values; }
}
function retain(values: int32[]): int32[] { return values; }
function first(values: int32[]): int32 { return values[0]; }
function replace(values: int32[]): void { values[0] = 7; }
function firstForwarded(values: int32[]): int32 { return first(values); }
function replaceForwarded(values: int32[]): void { replace(values); }
export function main(): void {
  const boxed = new Box([3 as int32]);
  const values = retain([5 as int32]);
  if (firstForwarded(boxed.values) !== 3 || firstForwarded(values) !== 5) throw new Error("native ownership");
  replaceForwarded(values);
  if (firstForwarded(values) !== 7) throw new Error("native mutation");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn new\(values: Vec<i32>\)/u);
  assert.match(output, /fn retain\(values: Vec<i32>\) -> Vec<i32>/u);
  assert.match(output, /fn first\(values: &\[i32\]\)/u);
  assert.match(output, /fn replace\(values: &mut \[i32\]\)/u);
  assert.match(output, /fn firstForwarded\(values: &\[i32\]\)/u);
  assert.match(output, /fn replaceForwarded\(values: &mut \[i32\]\)/u);
  assert.doesNotMatch(output, /to_vec\(|values\.clone\(/u);
  validateGeneratedProject("native-array-parameters", result.artifacts, { run: true });
});
