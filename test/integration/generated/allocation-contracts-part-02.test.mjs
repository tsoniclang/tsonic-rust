import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import { assertRustRecordRequirement } from "../../helpers/required-records.mjs";
import test from "node:test";
import { nativeFunction, nativeSource, nativeType, nativeBorrow, nativeMethods,
  assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { capturedStringOwnershipSource } from "../../../../tsonic/test/fixtures/captured-string-ownership.mjs";
import { compileRust, artifactText, analyzeRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRustReferenceOperationCall } from "../../../dist/backend/planner/expressions/reference-operations.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustReferenceOperations } from "../../../dist/analysis/operations/reference-operations.js";
import { createRustReferenceOperationProducer } from "../../../dist/analysis/program/records/operations/reference-operations.js";

test("non-consuming comparisons preserve authored clone calls and their effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
let calls = 0;
class Counter { clone(): string { calls++; return "value"; } }
export function main(): void {
  const counter = new Counter();
  let matches = 0;
  if (counter.clone() !== undefined) matches++;
  if ((counter.clone()) === "value") matches++;
  if ((counter.clone() as string) !== undefined) matches++;
  if (matches !== 3 || calls !== 3) throw new Error("authored call was erased");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.equal([...output.matchAll(/counter\.clone\(\)/gu)].length, 3);
  validateGeneratedProject("authored-clone-effects", result.artifacts, { run: true });
});

test("borrow proofs respect retained callable ABIs through direct and indirect forwarding", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
const normalize = (value: string): string => value.replaceAll("x", "");
function width(value: string): number { return normalize(value).length; }
function direct(values: string[]): void { values.sort((left, right) => {
  const leftSize = normalize(left).length;
  const rightSize = normalize(right).length;
  return leftSize < rightSize ? -1 : leftSize > rightSize ? 1 : 0;
}); }
function indirect(values: string[]): void { values.sort((left, right) => width(left) - width(right)); }
export function main(): void {
  const first = ["bbb", "xa", "cc"];
  const second = ["xxxz", "yyy", "aa"];
  direct(first);
  indirect(second);
  if (first.join("|") !== "xa|cc|bbb" || second.join("|") !== "xxxz|aa|yyy")
    throw new Error("retained callable ABI");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /ModuleCell<NormalizeCallable>/u);
  assert.match(output, /fn width\(value: String\)/u);
  assert.doesNotMatch(output, /sort_borrowed/u);
  validateGeneratedProject("retained-callable-borrow-proof", result.artifacts, { run: true });
});

test("explicit shared String references borrow captured storage without copying", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { ref } from "@tsonic/rust/lang.js";
import type { Ref } from "@tsonic/rust/types.js";
import { read_to_string, write } from "@tsonic/rust/std/fs.js";
function writer(value: string): () => void {
  const path = "captured-reference.txt";
  return () => { write<Ref<string>, Ref<string>>(ref(path), ref(value)).unwrap(); };
}
export function main(): void {
  const output = writer("abc");
  output();
  output();
  if (read_to_string<string>("captured-reference.txt").unwrap() !== "abc")
    throw new Error("captured borrow");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /std::fs::write::<&str, &str>\(&capture_path, &capture_value\)/u);
  assert.doesNotMatch(output, /&capture_(?:path|value)\.clone\(\)/u);
  validateGeneratedProject("captured-string-reference", result.artifacts, { run: true });
});

test("value and retained cursor methods keep exact receiver lint contracts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
class LocalCursor {
  position = 0;
  next(): number { this.position++; return this.position; }
}
export class RetainedCursor {
  position = 0;
  next(): number { this.position++; return this.position; }
}
export function retain(): RetainedCursor { return new RetainedCursor(); }
export function main(): void {
  const local = new LocalCursor();
  const retained = retain();
  const alias = retained;
  if (local.next() !== 1 || local.next() !== 2 || retained.next() !== 1 || alias.next() !== 2)
    throw new Error("cursor receiver contract");
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn next\(&mut self\)/u);
  assert.match(output, /fn next\(&self\)/u);
  validateGeneratedProject("cursor-receiver-lint-contract", result.artifacts, { run: true });
});
