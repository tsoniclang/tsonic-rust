import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("native integral bitwise operations preserve promotion and masked shifts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_bitwise" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32, uint8 } from "@tsonic/core/types.js";

export function main(): void {
  const left: int32 = 5;
  const right: int32 = 3;
  const one: int32 = 1;
  const width: int32 = 32;
  const negativeOne: int32 = -1;
  const highByte: uint8 = 128;

  check((left & right) === 1);
  check((left | right) === 7);
  check((left ^ right) === 6);
  check((one << width) === 1);
  check((negativeOne >> one) === negativeOne);
  check((negativeOne >>> one) === 2147483647);
  check((highByte << one) === 256);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /left & right/u);
  assert.match(source, /rt::native_shift_left\(one, width\)/u);
  assert.match(source, /rt::native_unsigned_shift_right\(negativeOne, one\)/u);
  assert.match(source, /rt::native_shift_left\(highByte as i32, one\)/u);
  validateGeneratedProject("native-bitwise", result.artifacts, { run: true });
});

test("source number bitwise operations retain the number carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "source_number_bitwise" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  const left: number = 5;
  const right: number = 3;
  const width: number = 32;
  const negativeOne: number = -1;

  check((left & right) === 1);
  check((left | right) === 7);
  check((left ^ right) === 6);
  check((left << width) === 5);
  check((negativeOne >> 1) === -1);
  check((negativeOne >>> 1) === 2147483647);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::source_number_bitwise_and/u);
  assert.match(source, /rt::source_number_shift_left/u);
  assert.match(source, /rt::source_number_unsigned_shift_right/u);
  validateGeneratedProject("source-number-bitwise", result.artifacts, { run: true });
});
