import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/index.js";

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
