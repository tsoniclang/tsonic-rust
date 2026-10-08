import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { nestedUnionProjectionFiles } from "../../../../tsonic/test/fixtures/nested-union-projections.mjs";

const cases = [[], ["js"]].flatMap(surfaces =>
  [false, true].map(parenthesized => ({ surfaces, parenthesized })));

for (const { surfaces, parenthesized } of cases) {
  test(`nested native union projections retain payload identity and one absence on ${surfaces[0] ?? "native"}${parenthesized ? " with parentheses" : ""}`, { timeout: 300_000 }, () => {
    const entry = parenthesized ? nestedUnionProjectionFiles["index.ts"].replaceAll("typeof value", "typeof (((value)))")
      : nestedUnionProjectionFiles["index.ts"];
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...nestedUnionProjectionFiles,
      "index.ts": entry + '\nexport function main(): void { if (!run()) throw new Error("nested union projections"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.find(artifact => artifact.path === "src/index.rs").text;
    const start = source.indexOf("fn read(");
    const end = source.indexOf("fn readOptional(");
    assert.ok(start >= 0 && end > start);
    const read = source.slice(start, end);
    const arrayVariant = surfaces.length === 0 ? 3 : 0;
    const stringVariant = surfaces.length === 0 ? 1 : 2;
    assert.equal(new RegExp(`Union4::Variant${arrayVariant}\\(flow_value_\\d+\\)\\s*=>\\s*flow_value_\\d+`, "u").test(read), true,
      "exact array payload remains a borrowed projection of the original carrier");
    assert.equal([...read.matchAll(/if \(match &value \{/gu)].length, 2, "both category inspections borrow actual storage");
    assert.equal(/union_value\w*\.clone\(\)/u.test(read), false,
      "runtime category inspection never reconstructs or clones a narrowed union");
    validateGeneratedProject("nested-union-projections", result.artifacts, { run: true });
    const directory = writeGeneratedProject("nested-union-inspection-cost", result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod union_inspection_cost {
    use super::*;
    ${nativeOwnershipCostSupport}
    #[test]
    fn narrowed_category_inspection_has_the_handwritten_native_cost() {
        for _ in 0..128 {
            let text = String::from("native union payload");
            let baseline = text.clone();
            let value = crate::shapes::Union4::Variant${stringVariant}(text);
            let (actual, cost) = measure(|| read(std::hint::black_box(value)).unwrap());
            let (expected, handwritten) = measure(|| {
                drop(std::hint::black_box(baseline));
                0_u64
            });
            assert_eq!(actual, expected);
            assert_eq!(cost, handwritten);
            assert_eq!(cost.allocations, 0);
            assert_eq!(cost.reallocations, 0);
            assert_eq!(cost.deallocations, 1);
        }
    }
}
`);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["fmt", "--all"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--locked", "--offline"]);
  });
}
