import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { providerEvaluationOrderSource } from "../../../../tsonic/test/fixtures/provider-evaluation-order.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("provider conversions borrow disjoint fields and snapshot values before overlapping receiver calls", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": providerEvaluationOrderSource + '\nexport function main(): void { if (!run()) throw new Error("native provider order"); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn replace\(&mut self\)/u);
  assert.match(output, /let operation_input_0 = self\.text\.clone\(\);/u);
  for (const name of ["next", "combined", "observed"]) {
    const start = output.indexOf(`pub fn ${name}(`);
    const nextMethod = output.indexOf("\n    pub fn ", start);
    const end = output.indexOf("\n}\n", start);
    assert.equal(start >= 0 && end > start, true, `${name} emitted method`);
    assert.doesNotMatch(output.slice(start, nextMethod < 0 ? end : Math.min(end, nextMethod)), /clone\(|operation_input/u);
  }
  const root = writeGeneratedProject("provider-evaluation-order", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  writeFileSync(join(root, "src/index.rs"), output + `
#[cfg(test)]
mod native_provider_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn disjoint_and_overlapping_reads_match_handwritten_allocation_cost() {
        let backing = "ab".repeat(4096);
        let mut generated = Cursor::new(backing.clone());
        let mut handwritten_text = backing.clone();
        for kind in 0..4 {
            for _ in 0..256 {
                generated.text.clone_from(&backing);
                handwritten_text.clone_from(&backing);
                generated.index = 0;
                let mut handwritten_index: i32 = 0;
                let (actual, actual_cost) = measure(|| {
                    let value = match kind {
                        0 => generated.next().unwrap(),
                        1 => generated.combined(1).unwrap(),
                        2 => generated.observed().unwrap(),
                        _ => generated.mutated().unwrap(),
                    };
                    std::hint::black_box(value.as_bytes()[0])
                });
                let (expected, expected_cost) = measure(|| {
                    let value = match kind {
                        0 | 1 => {
                            let index = handwritten_index;
                            handwritten_index += 1;
                            js_string::char_at(&handwritten_text, index + if kind == 1 { 1 } else { 0 }).unwrap()
                        },
                        2 => js_string::char_at(&handwritten_text, (handwritten_text.len() - 1) as i32).unwrap(),
                        _ => {
                            let snapshot = handwritten_text.clone();
                            handwritten_text = String::from("zz");
                            js_string::char_at(&snapshot, 0).unwrap()
                        },
                    };
                    std::hint::black_box(value.as_bytes()[0])
                });
                assert_eq!(actual, expected);
                assert_eq!(actual_cost, expected_cost);
                assert_eq!(generated.index, handwritten_index);
                assert_eq!(generated.text, handwritten_text);
            }
        }
    }
}
`);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
  runCargo(root, ["run", "--locked", "--offline"]);
});
