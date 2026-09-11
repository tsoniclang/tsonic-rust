import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { memoryAbiCapability, rawAddressProofSource } from "../../../helpers/memory-abi.mjs";

test("raw address integers preserve every bit through nested native byte offsets", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": rawAddressProofSource + `
export function main(): void { if (!run()) throw new Error("raw address round trip"); }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /9007199254740993/u);
  assert.match(output, /RawPointer::offset_unsigned/u);
  assert.doesNotMatch(output, /as f64|\bunsafe\b/u);
  assert.doesNotMatch(output, /header_alias|header_layout|local_layout|tag_field/u);
  validateGeneratedProject("raw-address-round-trip", result.artifacts, { run: true });
});

test("32-bit address ABI retains its exact native unsigned result", () => {
  const { result } = compileRust({ capabilities: [memoryAbiCapability("rust", 32)], files: { "index.ts": `
import { abi } from "test:abi";
import { addressIntegerToRawPointer, rawPointerToAddressInteger } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
export function roundTrip(bits: uint32): uint32 {
  return rawPointerToAddressInteger<uint32>(addressIntegerToRawPointer(bits, abi), abi);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /-> u32/u);
  assert.match(output, /32u32/u);
  assert.doesNotMatch(output, /as f64/u);
});

test("layout-query offsets preserve typed literal conversions and exact native addresses", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { abi } from "test:abi";
import { memoryLayout, memoryField, sizeOf, alignOf, strideOf, fieldOffsetOf,
  offsetRawPointer, rawPointerToAddressInteger, addressIntegerToRawPointer } from "@tsonic/core/lang.js";
import type { uint32, uint64 } from "@tsonic/core/types.js";
interface Header { count: uint32 }
const word = memoryLayout<uint32>(abi, 4, 4, 4);
const header = memoryLayout<Header>(abi, 12, 4, 16,
  memoryField((value: Header) => value.count, 4, 4, word));
export function main(): void {
  const bits: uint64 = 9007199254740993n;
  const plus4: uint64 = 9007199254740997n;
  const plus12: uint64 = 9007199254741005n;
  const plus16: uint64 = 9007199254741009n;
  const plus20: uint64 = 9007199254741013n;
  const raw = addressIntegerToRawPointer(bits, abi);
  const bytes = sizeOf(header);
  if (rawPointerToAddressInteger<uint64>(offsetRawPointer(raw, sizeOf(header), abi), abi) !== plus12 ||
      rawPointerToAddressInteger<uint64>(offsetRawPointer(raw, alignOf(header), abi), abi) !== plus4 ||
      rawPointerToAddressInteger<uint64>(offsetRawPointer(raw, strideOf(header), abi), abi) !== plus16 ||
      rawPointerToAddressInteger<uint64>(offsetRawPointer(raw, fieldOffsetOf(header, value => value.count), abi), abi) !== plus4 ||
      rawPointerToAddressInteger<uint64>(offsetRawPointer(raw, bytes, abi), abi) !== plus12 ||
      rawPointerToAddressInteger<uint64>(offsetRawPointer(offsetRawPointer(raw, strideOf(header), abi), sizeOf(word), abi), abi) !== plus20) {
    throw new Error("layout query offsets changed the exact address");
  }
  const maximum: uint64 = 18446744073709551615n;
  if (rawPointerToAddressInteger<uint64>(addressIntegerToRawPointer<uint64>(18446744073709551615n, abi), abi) !== maximum ||
      rawPointerToAddressInteger<uint64>(offsetRawPointer(offsetRawPointer(raw, 4n, abi), -4n, abi), abi) !== bits) {
    throw new Error("unsuffixed literal address boundaries changed");
  }
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /usize as u128/u);
  assert.doesNotMatch(output, /as f64/u);
  validateGeneratedProject("layout-query-raw-offsets", result.artifacts, { run: true });
});

test("layout descriptors cannot escape into ordinary runtime returns", () => {
  const { result } = compileRust({ capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
import { abi } from "test:abi";
import { memoryLayout } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
export function escape(): unknown { const layout = memoryLayout<uint32>(abi, 4, 4, 4); return layout; }
` } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_MEMORY_METADATA_RUNTIME_ESCAPE"));
  assert.equal(result.artifacts.length, 0);
});
