import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/index.js";

test("canonical compiler BigInt width operations preserve native results", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "bigint_width" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let visits = 0;
function width(): number { visits = visits * 10 + 1; return 64; }
function value(): bigint { visits = visits * 10 + 2; return 18446744073709551615n; }
export function main(): void {
  check(globalThis.BigInt.asIntN(width(), value()) === -1n);
  check(visits === 12);
  check(BigInt.asUintN(64, -1n) === 18446744073709551615n);
  check(BigInt.asIntN(64, 9007199254740993n) === 9007199254740993n);
  check(BigInt.asIntN(9, 256n) === -256n);
  check(BigInt.asUintN(9, -1n) === 511n);
  let invalid = 0;
  try { BigInt.asIntN(Number.NaN, 4n); } catch { invalid += 1; }
  try { BigInt.asIntN(-0.5, 4n); } catch { invalid += 1; }
  check(invalid === 2);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("bigint-width", result.artifacts, { run: true });
});

test("canonical compiler string quoting retains its nonoptional result", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "json_string_result" } },
    files: { "index.ts": String.raw`
import { check } from "@acme/testing";
function quote(value: string): string { return JSON.stringify(value); }
export function main(): void {
  check(quote("héllo 😀") === '"héllo 😀"');
  check(JSON.stringify("line\n").slice(1, -1) === "line\\n");
  check(JSON.stringify(undefined) === undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("json-string-result", result.artifacts, { run: true });
});

test("String construction retains exact native primitive and numeric-union values", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "string_construction" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { int64, uint8 } from "@tsonic/core/types.js";
function numeric(value: number | bigint): string { return globalThis.String(value); }
function text(value: string): string { return String(value); }
function local(): string { const String = (value: number): string => "local"; return String(12); }
export function main(): void {
  check(String() === "" && String(undefined) === "undefined" && String(null) === "null");
  check(String(true) === "true" && String(false) === "false" && text("a😀z") === "a😀z");
  check(String(-0) === "0" && String(1.5) === "1.5" && String(1e21) === "1e+21");
  check(String(Number.NaN) === "NaN" && String(Number.POSITIVE_INFINITY) === "Infinity");
  check(String(Number.NEGATIVE_INFINITY) === "-Infinity");
  const wide: int64 = 9007199254740993n;
  const byte: uint8 = 255;
  check(String(wide) === "9007199254740993" && String(byte) === "255");
  check(String(-18446744073709551617n) === "-18446744073709551617");
  check(numeric(9007199254740993n) === "9007199254740993" && numeric(1.5) === "1.5");
  let evaluations = 0;
  const evaluate = (): number => { evaluations += 1; return 7; };
  check(String(evaluate()) === "7" && evaluations === 1 && local() === "local");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /rt::source_string/u);
  const native = validateGeneratedProject("string-construction", result.artifacts, { run: true });
  assert.equal(native.status, 0, JSON.stringify(native));
});

test("String construction does not invent dynamic object conversion or call identity", () => {
  assert.equal(selectJsSurfaceOperation({
    ownerName: "StringConstructor", memberName: "call", operationKind: "call",
    argumentCarriers: [rustJsValueTargetType()],
  }), undefined);
  assert.equal(selectJsSurfaceOperation({
    ownerName: "LocalConstructor", memberName: "call", operationKind: "call", argumentCarriers: [],
  }), undefined);
});

test("void values retain unit calls, optional conversion and equality effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
let visits = 0;
function value(): number { visits += 1; return visits; }
function unit(): void { visits += 1; }
function optional(value: number | undefined): boolean { return value === undefined; }
function compare(value: number | undefined): boolean { return value === void unit(); }
export function main(): void {
  if (String(void value()) !== "undefined" || String(void unit()) !== "undefined" ||
    !optional(void value()) || !optional(void unit()) || !compare(undefined) || visits !== 5) {
    throw new Error("void evaluation");
  }
}
` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("void-source-values", result.artifacts, { run: true });
});

test("void awaited unit and value operands preserve completion order", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
let visits = 0;
async function value(): Promise<number> { visits += 1; return visits; }
async function unit(): Promise<void> { visits += 1; }
function optional(value: number | undefined): boolean { return value === undefined; }
export async function main(): Promise<void> {
  if (!optional(void await value()) || !optional(void (await unit())) || visits !== 2) {
    throw new Error("awaited void evaluation");
  }
}
` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("void-awaited-values", result.artifacts, { run: true });
});

test("an infallible JS async entry awaits its selected promise representation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
let visits = 0;
async function unit(): Promise<void> { visits += 1; }
export async function main(): Promise<void> {
  void await unit();
  console.log(visits);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/main.rs"), /tsonic_entry\(\)\.into_value\(\)/u);
  const native = validateGeneratedProject("infallible-js-async-entry", result.artifacts, { run: true });
  assert.equal(native.stdout.trim(), "1");
});
