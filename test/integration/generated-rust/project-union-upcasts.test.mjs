import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("closed nominal union widening preserves live identity and virtual dispatch", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "project_union_upcasts" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
class Base { value: int32 = 3 as int32; read(): int32 { return this.value; } }
class Derived extends Base { read(): int32 { return (this.value + 1) as int32; } }
type Narrow = string | Derived;
type Wide = string | Base;
type Broad = boolean | Derived | string;
function widen(value: Narrow): Wide { return value; }
function narrowAndWiden(value: Broad): Wide {
  if (typeof value === "boolean") return "excluded";
  const result: Wide = value;
  if (typeof value === "string" && value !== "native text") throw new Error("retained string");
  return result;
}
export function main(): void {
  const original = new Derived();
  const narrow: Narrow = original;
  const widened = widen(narrow);
  if (typeof widened === "string") throw new Error("object arm");
  if (widened !== original || widened.read() !== (4 as int32)) throw new Error("identity or dispatch");
  original.value = 8 as int32;
  if (widened.read() !== (9 as int32)) throw new Error("live alias");
  if (widen("native text") !== "native text") throw new Error("string arm");
  const broad: Broad = original;
  const fused = narrowAndWiden(broad);
  if (typeof fused === "string" || fused !== original || fused.read() !== (9 as int32)) throw new Error("fused identity");
  if (narrowAndWiden("native text") !== "native text" || narrowAndWiden(false) !== "excluded") throw new Error("fused arms");
}
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /Any|downcast|into_any|from_closed|reflect/u);
  validateGeneratedProject("project-union-upcasts", result.artifacts, { run: true });
});
