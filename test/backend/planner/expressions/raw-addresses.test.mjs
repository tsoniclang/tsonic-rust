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
