import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("generic compiler container locations retain nested storage and propagate lifetime bounds", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "container_locations" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { addressOf, equalPointer, hashPointer, loadPointer, storePointer } from "@tsonic/core/lang.js";
import type { Pointer } from "@tsonic/core/types.js";
function first<T>(values: T[]): Pointer<T> { return addressOf<T>(values[0]); }
function forward<U>(values: U[]): Pointer<U> { return first<U>(values); }
function nested<V>(values: V[][]): Pointer<V> { return forward<V>(values[0]); }
export function main(): void {
  const values = [3, 4];
  const pointer = forward<number>(values);
  storePointer(pointer, 8);
  check(values[0] === 8 && loadPointer(pointer) === 8);
  const again = forward<number>(values);
  check(equalPointer(pointer, again) && hashPointer(pointer) === hashPointer(again));
  const outer = [values];
  const nestedPointer = nested<number>(outer);
  storePointer(nestedPointer, 9);
  check(loadPointer(pointer) === 9 && values[0] === 9);
  check(equalPointer(pointer, nestedPointer));
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-container-locations", result.artifacts, { run: true });
});
