import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { constrainedNamedFieldsSource } from "../../../../tsonic/test/fixtures/constrained-named-fields.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`constrained named fields preserve native widths and aliasing on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": constrainedNamedFieldsSource + '\nexport function main(): void { if (!run()) throw new Error("constrained fields"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = artifactText(result, "src/index.rs");
    assert.equal(/Output = i64/u.test(source), true, "constraint retains the exact native carrier");
    assert.equal(/transmute|into_any|f64/u.test(source), false, "field constraints require no erasure or floating conversion");
    validateGeneratedProject("constrained-named-fields", result.artifacts, { run: true });
    const directory = writeGeneratedProject("constrained-field-cost", result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod constrained_field_cost {
    use super::*;
    ${nativeOwnershipCostSupport}
    #[test]
    fn generic_named_field_read_is_a_zero_allocation_native_observation() {
        for _ in 0..128 {
            let entry = Entry::new();
            let expected = read(entry.clone()).unwrap();
            let (actual, cost) = measure(|| read(std::hint::black_box(entry.clone())).unwrap());
            assert_eq!(actual, expected);
            assert_eq!(cost, Cost::default());
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
