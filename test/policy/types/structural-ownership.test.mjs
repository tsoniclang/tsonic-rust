import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";

for (const [name, declarations, type] of [
  ["direct", "", "RawPointer"],
  ["alias", "type Address = RawPointer;", "Address"],
  ["nested", "interface Holder { address: RawPointer; }", "Holder"],
]) {
  test(`unrepresented external ${name} types reject without querying foreign structural fields`, () => {
    const { source, result } = compileRust({
      files: {
        "index.ts": `
import type { RawPointer } from "@tsonic/core/types.js";
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
            message: "Record field 'address' has no supported Rust carrier fact. Node kind: KindPropertySignature.",
          }
        : {
            code: "RUST_PARAMETER_CARRIER_UNSUPPORTED",
            message: "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
          },
    ]);
    assert.deepEqual(result.artifacts, []);
  });
}

test("project structural fields and exact utility transformations retain their carriers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
interface Box { value: int32; label: string; }
type Selected = Readonly<Pick<Box, "value">>;
export function read(box: Box): int32 { return box.value; }
export function readSelected(box: Selected): int32 { return box.value; }
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn read\(/u);
  assert.match(output, /pub fn read_selected\(/u);
  assert.match(output, /-> i32/u);
});
