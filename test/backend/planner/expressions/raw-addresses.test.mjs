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
import { addressintegertorawptr, rawptrtoaddressinteger } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
export function roundTrip(bits: uint32): uint32 {
  return rawptrtoaddressinteger<uint32>(addressintegertorawptr(bits, abi), abi);
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
import { memorylayout, memoryfield, sizeof, alignof, strideof, fieldoffsetof,
  offsetrawptr, rawptrtoaddressinteger, addressintegertorawptr } from "@tsonic/core/lang.js";
import type { uint32, uint64 } from "@tsonic/core/types.js";
interface Header { count: uint32 }
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
const header = memorylayout<Header>({ datalayout: abi, bytesize: 12, bytealignment: 4, stride: 16,
  fields: [memoryfield({ select: (value: Header) => value.count, byteoffset: 4, bytealignment: 4, fieldlayout: word })] });
export function main(): void {
  const bits: uint64 = 9007199254740993n;
  const plus4: uint64 = 9007199254740997n;
  const plus12: uint64 = 9007199254741005n;
  const plus16: uint64 = 9007199254741009n;
  const plus20: uint64 = 9007199254741013n;
  const raw = addressintegertorawptr(bits, abi);
  const bytes = sizeof(header);
  if (rawptrtoaddressinteger<uint64>(offsetrawptr(raw, sizeof(header), abi), abi) !== plus12 ||
      rawptrtoaddressinteger<uint64>(offsetrawptr(raw, alignof(header), abi), abi) !== plus4 ||
      rawptrtoaddressinteger<uint64>(offsetrawptr(raw, strideof(header), abi), abi) !== plus16 ||
      rawptrtoaddressinteger<uint64>(offsetrawptr(raw, fieldoffsetof(header, value => value.count), abi), abi) !== plus4 ||
      rawptrtoaddressinteger<uint64>(offsetrawptr(raw, bytes, abi), abi) !== plus12 ||
      rawptrtoaddressinteger<uint64>(offsetrawptr(offsetrawptr(raw, strideof(header), abi), sizeof(word), abi), abi) !== plus20) {
    throw new Error("layout query offsets changed the exact address");
  }
  const maximum: uint64 = 18446744073709551615n;
  if (rawptrtoaddressinteger<uint64>(addressintegertorawptr<uint64>(18446744073709551615n, abi), abi) !== maximum ||
      rawptrtoaddressinteger<uint64>(offsetrawptr(offsetrawptr(raw, 4n, abi), -4n, abi), abi) !== bits) {
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
import { memorylayout } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
export function escape(): unknown { const layout = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] }); return layout; }
` } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_MEMORY_METADATA_RUNTIME_ESCAPE"));
  assert.equal(result.artifacts.length, 0);
});
