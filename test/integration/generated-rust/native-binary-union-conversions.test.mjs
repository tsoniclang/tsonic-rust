import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("closed binary unions retain their exact provider inheritance and native payloads", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_binary_unions" } },
    files: { "index.ts": `
import { Buffer } from "node:buffer";
type BinaryBody = Buffer | Uint8Array | string;
function inspect(value: BinaryBody | undefined): boolean {
  if (value == null) return true;
  if (value instanceof Buffer) return value.toString() === "abc";
  if (value instanceof Uint8Array) return Buffer.from(value).toString() === "abc";
  return value === "abc";
}
function textOrBytes(value: boolean): BinaryBody {
  return value ? Buffer.from("abc") : new Uint8Array([97, 98, 99]);
}
export function main(): void {
  if (!inspect(textOrBytes(true)) || !inspect(textOrBytes(false)) ||
      !inspect("abc") || !inspect(undefined)) throw new Error("binary union");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /JsValue::|from_closed|into_iter\(\).*collect|Any|downcast/u);
  validateGeneratedProject("native-binary-union-conversions", result.artifacts, { run: true });
});
