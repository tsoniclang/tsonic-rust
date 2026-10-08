import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { recursiveFieldConstructionSource } from "../../../../tsonic/test/fixtures/recursive-field-construction.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) test(`recursive field transport retains a live constructor activation in ${surfaces[0] ?? "native"}`,
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": recursiveFieldConstructionSource } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = artifactText(result, "src/index.rs");
    assert.equal(source.includes("construction_frame"), true, "the frame exists before the checked callback transport");
    assert.equal(source.includes("FrameCallable::from_frame"), true, "owning publication retains its exact activation");
    assert.equal(source.includes("transmute"), false);
    validateGeneratedProject(`recursive-field-construction-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`recursive-field-construction-cost-${surfaces[0] ?? "native"}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod constructor_frame_cost {
    use super::*;
    ${nativeOwnershipCostSupport}
    #[test]
    fn transported_entries_allocate_only_their_frames_and_release_them() {
        for _ in 0..32 {
            let (result, cost) = measure(|| run().unwrap());
            assert!(result);
            assert_eq!(cost.allocations, 2);
            assert_eq!(cost.deallocations, 2);
            assert_eq!(cost.allocated_bytes, cost.deallocated_bytes);
            assert_eq!(cost.reallocations, 0);
        }
    }
}
`);
    const executed = runCargo(directory, ["test", "--release", "--", "--test-threads=1"]);
    assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
  });
