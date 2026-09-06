import assert from "node:assert/strict";
import test from "node:test";
import { acmePlatformPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";

for (const [name, declarations, type] of [
  ["direct", "", "MemoryLayout<uint32>"],
  ["alias", "type Layout = MemoryLayout<uint32>;", "Layout"],
  ["nested", "interface Holder { layout: MemoryLayout<uint32>; }", "Holder"],
  ["readonly", "", "Readonly<RawPointer>"],
  ["picked", "", "Pick<RawPointer, keyof RawPointer>"],
]) {
  test(`unrepresented external ${name} types reject without querying foreign structural fields`, () => {
    const { source, result } = compileRust({
      files: {
        "index.ts": `
import type { MemoryLayout, RawPointer, uint32 } from "@tsonic/core/types.js";
${declarations}
export function pass(value: ${type}): ${type} { return value; }
`,
      },
    });
    assert.deepEqual(source.extensionDiagnostics, []);
    assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [
      name === "nested"
        ? {
            code: "RUST_MISSING_TARGET_FACT",
            message: "Record field 'layout' has no supported Rust carrier fact. Node kind: KindPropertySignature.",
          }
        : {
            code: "RUST_PARAMETER_CARRIER_UNSUPPORTED",
            message: "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
          },
    ]);
    assert.deepEqual(result.artifacts, []);
  });
}

test("represented raw pointers retain their opaque carrier through aliases and record fields", () => {
  const { source, result } = compileRust({
    files: {
      "index.ts": `
import type { RawPointer } from "@tsonic/core/types.js";
type Address = RawPointer;
interface Holder { address: Address; }
export function pass(value: RawPointer): RawPointer { return value; }
export function alias(value: Address): Address { return value; }
export function nested(value: Holder): RawPointer { return value.address; }
`,
    },
  });
  assert.deepEqual(source.extensionDiagnostics, []);
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /use tsonic_rust_runtime as rt;/u);
  assert.match(output, /pub fn pass\(value: rt::RawPointer\) -> rt::RawPointer/u);
  assert.match(output, /pub fn alias\(value: rt::RawPointer\) -> rt::RawPointer/u);
  assert.match(output, /pub fn nested\(value: Holder\) -> rt::RawPointer/u);
  assert.doesNotMatch(output, /__tsonicRawPointer|__tsonic_raw_pointer/u);
});

test("project structural fields and exact utility transformations retain their carriers", () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Store } from "@acme/platform";
interface Box { value: int32; label: string; }
type Selected = Readonly<Pick<Box, "value">>;
export function read(box: Box): int32 { return box.value; }
export function readSelected(box: Selected): int32 { return box.value; }
export function readProvider(value: Pick<Store, "count">): number { return value.count; }
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn read\(/u);
  assert.match(output, /pub fn read_selected\(/u);
  assert.match(output, /pub fn read_provider\(/u);
  assert.match(output, /-> i32/u);
});
