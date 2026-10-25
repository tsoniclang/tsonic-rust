import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  analyzeRust,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";

test("signed all-ones identities preserve the retained native operand conversion and its effects", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32, uint8 } from "@tsonic/core/types.js";
export function rightMask(value: uint8): int32 { return value & -1; }
export function leftMask(value: uint8): int32 { return -1 & value; }
function next(value: uint8): uint8 { return value; }
export function effect(value: uint8): int32 { return next(value) & -1; }
export function ordinary(value: int32, mask: int32): int32 { return value & mask; }
` } });
  const ast = program.source.ast;
  const binaries = [];
  const visit = node => {
    if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindAmpersandToken") binaries.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(binaries.length, 4, "both mask orders, the effectful retained value and the unknown-mask inverse survive source checking");
  for (const [index, node] of binaries.entries()) {
    const selected = program.records.nativeComparison.get(node);
    if (index === 3) {
      assert.equal(selected?.kind, "ordinary", "an unknown mask is never erased");
      continue;
    }
    const operand = index === 1 ? "right" : "left";
    assert.equal(selected?.kind, "integer-identity", `${index}: native signed all-ones identity is proven`);
    assert.equal(selected.operand, operand, `${index}: preserve exactly the non-mask operand`);
    const operation = program.records.targetOperation.get(node);
    assert.equal(operation?.kind, "operator-token", `${index}: the existing native operation contract remains canonical`);
    assert.equal(operation[`${operand}Conversion`] !== undefined, true, `${index}: the uint8-to-int32 conversion is not lost`);
    assert.equal(operation[index === 1 ? "leftConversion" : "rightConversion"] === undefined, true,
      `${index}: only the exact unconverted pure mask may be discarded`);
    const source = operand === "left" ? BinaryExpression_Left(ast, node) : BinaryExpression_Right(ast, node);
    if (index === 2) assert.equal(ast.is.IsCallExpression(source), true, "the retained source effect is not replaced by a constant");
  }
});

for (const surfaces of [[], ["js"]]) {
  test(`small integer complement retains the native operand width (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "native_complement" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
import type { int8, uint8, int16, uint16, int32 } from "@tsonic/core/types.js";
function signed8(value: int8): int8 { return ~value; }
function unsigned8(value: uint8): uint8 { return ~value; }
function signed16(value: int16): int16 { return ~value; }
function unsigned16(value: uint16): uint16 { return ~value; }
function before(value: uint8): int32 { return ~(value as int32); }
function after(value: uint8): int32 { return (~value) as int32; }
export function main(): void {
  check(signed8(-128) === 127 && signed8(-1) === 0);
  check(unsigned8(255) === 0 && unsigned8(128) === 127);
  check(signed16(-32768) === 32767 && unsigned16(65535) === 0);
  check(before(255) === -256 && after(255) === 0);
}
main();
` },
    });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /fn unsigned8\(value: u8\) -> u8 \{\s*!value\s*\}/u);
    assert.match(source, /fn signed16\(value: i16\) -> i16 \{\s*!value\s*\}/u);
    validateGeneratedProject(`native-complement-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });

  test(`bigint bitwise operations retain arbitrary precision (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "bigint_bitwise" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
function invert(value: bigint): bigint { return ~value; }
function combine(left: bigint, right: bigint): bigint { return (left | right) ^ (left & right); }
export function main(): void {
  const high = 18446744073709551616n;
  const mask = 18446744073709551615n;
  const alias = high;
  let value = high;
  value |= mask;
  check(value === 36893488147419103231n);
  value ^= mask;
  check(value === high);
  value &= mask;
  check(value === 0n && alias === high);
  const assigned = value |= high;
  check(assigned === high && value === high);
  check(invert(mask) === -high && invert(-1n) === 0n);
  check(combine(high, mask) === 36893488147419103231n);
}
main();
` },
    });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /!value/u);
    assert.doesNotMatch(source, /as (?:f32|f64|i64|u64)/u);
    validateGeneratedProject(`bigint-bitwise-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });

  test(`consumed compound assignments preserve stores and failure order (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "compound_assignment_values" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
let trace = "";
class Counter {
  value = 21n;
  static shared = 3n;
  get amount(): bigint { trace += "get;"; return this.value; }
  set amount(value: bigint) { trace += "set;"; this.value = value; }
}
const counter = new Counter();
function owner(): Counter { trace += "owner;"; return counter; }
function divisor(): bigint { trace += "right;"; counter.value = 100n; return 3n; }
export function main(): void {
  const divided = owner().amount /= divisor();
  check(divided === 7n && counter.value === 7n && trace === "owner;get;right;set;");
  trace = "";
  let failed = false;
  try { const result = owner().amount /= 0n; check(result === 0n); }
  ${surfaces.length === 0 ? "catch { failed = true; }" : "catch (error) { failed = error instanceof RangeError; }"}
  check(failed && counter.value === 7n && trace === "owner;get;");
  const shifted = Counter.shared <<= 2n;
  check(shifted === 12n && Counter.shared === 12n);
  let count = 1;
  const sum = count += 4;
  check(sum === 5 && count === 5);
  const values = [3n];
  const indexed = values[0] <<= 2n;
  check(indexed === 12n && values[0] === 12n);
  let indexReads = 0;
  const index = (): number => { indexReads += 1; return 0; };
  const accumulated = values[index()] += values[0];
  check(accumulated === 24n && values[0] === 24n && indexReads === 1);
}
main();
` },
    });
    assert.deepEqual(result.diagnostics, []);
    if (surfaces.length === 0) assert.doesNotMatch(artifactText(result, "src/index.rs"), /values\.clone\(\)|values\.to_vec\(\)/u);
    validateGeneratedProject(`compound-assignment-values-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("native integral bitwise operations preserve widths and native shifts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_bitwise" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32, uint8 } from "@tsonic/core/types.js";

let identityReads: int32 = 0;
function nativeValue(): uint8 { identityReads += 1; return 128; }

export function main(): void {
  const left: int32 = 5;
  const right: int32 = 3;
  const one: int32 = 1;
  const width: int32 = 3;
  const negativeOne: int32 = -1;
  const highByte: uint8 = 128;

  check((left & right) === 1);
  check((left | right) === 7);
  check((left ^ right) === 6);
  check((one << width) === 8);
  check((negativeOne >> one) === negativeOne);
  check((negativeOne >>> one) === 2147483647);
  check((highByte << one) === 0);
  check(((highByte as int32) << one) === 256);
  check((highByte & 0x3fff) === 128);
  check((0x3fff & highByte) === 128);
  check((highByte | 0x100) === 384);
  check((highByte & -1) === 128);
  check((-1 & highByte) === 128);
  check((nativeValue() & -1) === 128);
  check(identityReads === 1);
  check((highByte | -256) === -128);
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /left & right/u);
  assert.match(source, /rt::native_shift_left\(one, width\)/u);
  assert.match(source, /rt::native_unsigned_shift_right\(negativeOne, one\)/u);
  assert.match(source, /rt::native_shift_left\(rt::conversions::u8_to_i32\(highByte\), one\)/u);
  validateGeneratedProject("native-bitwise", result.artifacts, { run: true });
});

for (const operator of ["&", "|", "^", "<<", ">>", ">>>"]) {
  test(`floating operands require explicit integer selection for ${operator}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function calculate(left: number, right: number): number { return left ${operator} right; }
` } });
    assert(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED"),
      JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`compound snapshots retain local and indexed stores through failure without copying owners (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "compound_previous_acquisition" } },
      files: { "index.ts": `
import { check } from "@acme/testing";
function make(): bigint[] { return [3n]; }
export function main(): void {
  let scalar = 12n;
  const sum = scalar += 3n;
  check(sum === 15n && scalar === 15n);
  let failed = false;
  try { const impossible = scalar /= 0n; check(impossible === 0n); } catch { failed = true; }
  check(failed && scalar === 15n);
  const values = [7n];
  let indexReads = 0;
  const index = (): number => { indexReads += 1; return 0; };
  const accumulated = values[index()] += values[0];
  check(accumulated === 14n && values[0] === 14n && indexReads === 1);
  failed = false;
  try { const impossible = values[index()] /= 0n; check(impossible === 0n); } catch { failed = true; }
  check(failed && values[0] === 14n && indexReads === 2);
  const fresh = make()[0] += 2n;
  check(fresh === 5n);
  let word = "left";
  const concatenated = word += "!";
  check(concatenated === "left!" && word === "left!");
  const words = ["native"];
  const indexedWord = words[0] += "!";
  check(indexedWord === "native!" && words[0] === "native!");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    const source = artifactText(result, "src/index.rs");
    if (surfaces.length === 0) assert.doesNotMatch(source, /\b(?:values|words)\.(?:clone|to_vec)\(\)/u,
      "previous-value snapshots never duplicate their native collection owners");
    validateGeneratedProject(`compound-previous-acquisition-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
