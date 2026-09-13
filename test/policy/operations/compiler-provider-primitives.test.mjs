import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider integer formatting and string iteration run natively", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_primitives" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function format(value: bigint, radix: number): string { return value.toString(radix); }
export function main(): void {
  check(format(-9007199254740993n, 16) === "-20000000000001");
  check(format(35n, 36) === "z");
  check((9007199254740993n).toString() === "9007199254740993");
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  const shifted = new DataView(buffer, 1, 8);
  shifted.setBigUint64(0, 9007199254740993n, true);
  check(view.getBigUint64(1, true) === 9007199254740993n);
  view.setBigUint64(0, -1n);
  check(view.getBigUint64(0) === 18446744073709551615n);
  let source = "aé😀z";
  let visited = "";
  let count = 0;
  for (const value of source) {
    visited += value;
    count += 1;
    source = "changed";
  }
  check(visited === "aé😀z" && count === 4 && source === "changed");
  for (const value of "") { visited += value; count += 1; }
  check(count === 4);
  for (const value of "xyz") { visited = value; break; }
  check(visited === "x");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-primitives", result.artifacts, { run: true });
});
