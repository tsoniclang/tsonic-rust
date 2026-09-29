import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`nested union regrouping retains exact payloads on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint64 } from "@tsonic/core/types.js";
type TextOrValues = string | uint64[];
type FlagOrAction = boolean | (() => uint64);
type Grouped = TextOrValues | FlagOrAction;
type Flat = string | uint64[] | boolean | (() => uint64);
type Generic<T> = string | T[];
function readGeneric(value: Generic<uint64>): uint64 {
  return typeof value === "string" ? 0n : value[0];
}
function group(value: Flat): Grouped { return value; }
function flatten(value: Grouped): Flat { return value; }
function read(value: Flat): uint64 {
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "string") return 2n;
  if (typeof value === "function") return value();
  return value[0];
}
export function main(): void {
  const wide: uint64 = 9007199254740993n;
  const values = [wide];
  check(readGeneric(values) === wide);
  const grouped = group(values);
  ${surfaces.length === 0 ? "" : "values[0] = wide + 1n;"}
  check(read(flatten(grouped)) === ${surfaces.length === 0 ? "wide" : "wide + 1n"} && read(flatten(group("text"))) === 2n &&
    read(flatten(group(true))) === 1n && read(flatten(group(() => wide))) === wide);
}
` } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("nested-union-mappings", result.artifacts, { run: true });
  });
}
