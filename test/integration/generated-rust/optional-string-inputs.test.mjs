import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("optional and refined native string inputs preserve exact borrowed ABI without input copies", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function normalize(value: string | undefined): string | undefined {
      return value?.trim().toLowerCase();
    }
    export function refined(value: string | undefined): boolean {
      if (value === undefined) return true;
      const trimmed = value.trim();
      const lowercase = value.toLowerCase();
      return trimmed === lowercase;
    }
  ` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /core::convert::AsRef::<str>::as_ref/u);
  assert.doesNotMatch(output, /\.map\(js_string::(?:trim|to_lower_case)\)/u);
  const directory = writeGeneratedProject("optional-string-inputs", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod string_input_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn borrowed_native_string_inputs_match_handwritten_cost() {
        for present in [false, true] {
            let (expected, expected_cost) = measure(|| {
                let value = present.then(|| String::from(" NATIVE "));
                value.as_ref().map(|text| {
                    let trimmed = js_string::trim(text);
                    js_string::to_lower_case(&trimmed)
                })
            });
            let (actual, actual_cost) = measure(|| {
                normalize(present.then(|| String::from(" NATIVE ")))
            });
            assert_eq!(actual, expected);
            assert_eq!(actual_cost, expected_cost);
            let (expected, expected_cost) = measure(|| {
                let value = present.then(|| String::from("native"));
                value.as_ref().is_none_or(|text| {
                    let trimmed = js_string::trim(text);
                    let lowercase = js_string::to_lower_case(text);
                    trimmed == lowercase
                })
            });
            let (actual, actual_cost) = measure(|| {
                refined(present.then(|| String::from("native")))
            });
            assert_eq!(actual, expected);
            assert_eq!(actual_cost, expected_cost);
        }
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
});
