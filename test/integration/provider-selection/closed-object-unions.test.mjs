import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`closed interface unions preserve narrowing and selected storage in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "closed_object_unions" } },
      files: { "index.ts": `
interface Numeric { readonly kind: "number"; value: number }
interface Textual { readonly kind: "text"; value: string }
function change(value: Numeric | Textual): number {
  if (value.kind === "number") { value.value += 1; return value.value; }
  return value.value === "ready" ? 7 : 0;
}
export function main(): void {
  const numeric: Numeric = {kind: "number", value: 4};
  const textual: Textual = {kind: "text", value: "ready"};
  if (change(numeric) !== 5 || numeric.value !== 5 || change(textual) !== 7) throw new Error("closed union");
}
` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject("closed-object-unions", result.artifacts, { run: true }).status, 0);
  });
}
