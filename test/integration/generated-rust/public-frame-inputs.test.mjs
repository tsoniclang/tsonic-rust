import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { publicFrameInputsSource } from "../../../../tsonic/test/fixtures/public-frame-inputs.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject, writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) test(`public type-query frame inputs preserve native owners in ${surfaces[0] ?? "native"}`,
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": publicFrameInputsSource } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`public-frame-inputs-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`public-frame-input-cost-${surfaces[0] ?? "native"}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod public_frame_input_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn public_type_query_does_not_add_adapter_allocations_or_strong_cycles() {
        let (retained, creation) = measure(retainedRoot);
        assert_eq!(creation.allocations, 1, "one original native frame");
        assert_eq!(creation.deallocations, 0);
        assert_eq!(creation.reallocations, 0);
        let (result, invocation) = measure(|| retained.call((32.0,)).unwrap());
        assert_eq!(result, 1.0);
        assert_eq!(invocation, Cost::default());
        let (_, released) = measure(|| drop(retained));
        assert_eq!(released.deallocations, 1);
        assert_eq!(released.deallocated_bytes, creation.allocated_bytes);
    }
}
`);
    runCargo(directory, ["test", "--release", "--offline", "--", "--test-threads=1"]);
  });
