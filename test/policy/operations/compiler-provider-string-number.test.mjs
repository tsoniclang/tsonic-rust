import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("closed string-number unions retain native scalar refinement and strict identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "string_number" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function describe(value: string | number): number {
  if (typeof value === "string") return value.length;
  return value + 1;
}
function isNull(value: string | number | null | undefined): boolean { return value === null; }
function isUndefined(value: string | number | null | undefined): boolean { return value === undefined; }
function reversedNull(value: string | number | null | undefined): boolean { return null === value; }
function reversedUndefined(value: string | number | null | undefined): boolean { return undefined === value; }
export function main(): void {
  check(describe("pipe") === 4 && describe(3) === 4);
  check(isNull(null) && isNull(undefined) && !isNull("null"));
  check(isUndefined(undefined) && isUndefined(null) && !isUndefined(0));
  check(reversedNull(null) && reversedNull(undefined));
  check(reversedUndefined(undefined) && reversedUndefined(null));
}
` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-string-number", result.artifacts, { run: true });
});

test("stdio still rejects boolean inputs at the source declaration", async () => {
  const capability = await nodejsCapability();
  assert.throws(() => compileRust({ surfaces: ["js"], capabilities: [capability], files: {
    "index.ts": `import type { SpawnSyncOptionsWithBufferEncoding } from "node:child_process";
export const options: SpawnSyncOptionsWithBufferEncoding = { stdio: [true] };`,
  } }), /TS2322/);
});

test("closed native unions do not substitute native equality for coercing equality", () => {
  const { result } = compileRust({ surfaces: ["js"], files: {
    "index.ts": `export function compare(left: string | number, right: string | number): boolean {
  return left == right;
}`,
  } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
  assert.equal(result.artifacts.length, 0);
});

test("nullable native unions coalesce lazily without losing present values", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
import { check } from "@acme/testing";
let calls = 0;
function right(value: string | number | null | undefined): string | number | null | undefined {
  calls += 1;
  return value;
}
function coalesce(left: string | number | null | undefined, value: string | number | null | undefined): string | number | null | undefined {
  return left ?? right(value);
}
export function main(): void {
  check(coalesce("", "fallback") === "" && calls === 0);
  check(coalesce(0, 3) === 0 && calls === 0);
  check(coalesce(null, "fallback") === "fallback" && calls === 1);
  check(coalesce(undefined, 7) === 7 && calls === 2);
  check(coalesce(null, undefined) === null && calls === 3);
  check(coalesce(undefined, null) === undefined && calls === 4);
}`,
  } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("nullable-native-union-coalescing", result.artifacts, { run: true });
});
