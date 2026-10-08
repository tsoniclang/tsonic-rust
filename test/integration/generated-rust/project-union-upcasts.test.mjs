import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertCheckedNativeProjection } from "../../helpers/checked-native-projection.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

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
  assertCheckedNativeProjection(source);
  validateGeneratedProject("project-union-upcasts", result.artifacts, { run: true });
  const directory = writeGeneratedProject("project-union-upcast-cost", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod union_upcast_cost {
    use super::*;
    ${nativeOwnershipCostSupport}
    #[test]
    fn widening_moves_the_existing_native_identity_without_allocating() {
        for _ in 0..128 {
            let original = Derived::new();
            let input = crate::shapes::Union2::Variant1(original.clone());
            let (output, cost) = measure(|| widen(std::hint::black_box(input)));
            assert_eq!(cost, Cost::default());
            match output {
                crate::shapes::Union2::Variant1(value) => {
                    assert_eq!(value.identity, original.identity);
                    assert_eq!(value.dispatch.read_base_value(), 3);
                }
                crate::shapes::Union2::Variant0(_) => panic!("nominal arm lost"),
            }
        }
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline"]);
});
