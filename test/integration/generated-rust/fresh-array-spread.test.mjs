import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject, writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { freshArraySpreadSource, freshArraySpreadJsSource, freshArraySpreadCostSource, mutableArrayWideningSource } from "../../../../tsonic/test/fixtures/fresh-array-spread.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`fresh dense spread uses exact element conversions on ${surfaces.length === 0 ? "native" : "JS"} storage`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": (surfaces.length === 0 ? freshArraySpreadSource : freshArraySpreadJsSource) + '\nexport function main(): void { if (!run()) throw new Error("fresh spread"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith("index.rs")).map(artifact => artifact.text).join("\n");
    assert.ok(source.length > 0);
    assert.doesNotMatch(source, /\.values\(\)|\.to_vec\(\)|\.collect::<|Box::new/);
    validateGeneratedProject(`fresh-array-spread-${surfaces.length}`, result.artifacts, { run: true });
  });

  test(`mutable array widening stays rejected on ${surfaces.length === 0 ? "native" : "JS"} storage`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": mutableArrayWideningSource } });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  });
}

test("fresh numeric spread allocates only its destination, matching handwritten native loops", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "lib", crateName: "fresh_spread_cost" } },
    files: { "index.ts": freshArraySpreadCostSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const root = writeGeneratedProject("fresh-array-spread-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/cost.rs"), nativeOwnershipCostSupport + `
use fresh_spread_cost::index;
fn handwritten(values: &mut [u8]) -> Vec<f64> {
    let mut result = Vec::new();
    result.extend(values.iter().copied().map(f64::from));
    result
}
#[test]
fn native_spread_cost() {
    for length in [1, 2, 10, 128] {
        let mut input = vec![7u8; length];
        for _ in 0..10000 {
            let (generated, cost) = measure(|| index::widen(&mut input));
            let (expected, expected_cost) = measure(|| handwritten(&mut input));
            assert_eq!(generated, expected);
            assert_eq!(cost, expected_cost);
            assert_eq!(cost.allocations, 1);
            assert_eq!(cost.reallocations, 0);
        }
        let mut copied = index::copy(&mut input);
        copied[0] = 9;
        assert_eq!(copied.len(), length);
        assert_eq!(input[0], 7);
    }
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt"]);
  runCargo(root, ["check", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

test("fresh spread cannot copy native mutable references without a Clone contract", () => {
  const { result } = compileRust({ files: { "index.ts": `
import type { Mut } from "@tsonic/rust/types.js";
import type { int32 } from "@tsonic/core/types.js";
export function invalid(values: Mut<int32>[]): Mut<int32>[] { return [...values]; }
` } });
  assert.ok(result.diagnostics.some(diagnostic => /Clone|clone/.test(diagnostic.message)));
  assert.equal(result.artifacts.length, 0);
});
