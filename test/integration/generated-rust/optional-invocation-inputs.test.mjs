import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { optionalInvocationInputsSource } from "../../../../tsonic/test/fixtures/optional-invocation-inputs.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`optional invocation inputs retain exact native width, loans and laziness in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalInvocationInputsSource + '\nexport function main(): void { if (!run()) throw new Error("optional invocation input"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /Option<&impl\s+(?:for<[^>]+>\s+)?rt::CallableImplementation/u);
    assert.doesNotMatch(source, /action\.clone\(\)|action:\s*Option<&dyn/u);
    validateGeneratedProject(`optional-invocation-inputs-${lane}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`optional-invocation-input-cost-${lane}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod optional_input_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn optional_inputs_do_not_allocate_a_callback_or_copy_the_owned_string() {
        module_init();
        let (expected, native_cost) = measure(|| {
            let value = String::from("native");
            value.as_str() == "native"
        });
        let (actual, generated_cost) = measure(|| run().unwrap());
        assert!(expected && actual);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        assert_eq!(generated_cost.reallocations, 0);
        assert_eq!(generated_cost.allocated_bytes, 6);
    }
}
`);
    runCargo(directory, ["fmt", "--all"]);
    runCargo(directory, ["clippy", "--all-targets", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--release", "--offline", "--", "--test-threads=1"]);
  });
}
