import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { independentFrameAlternativesSource } from "../../../../tsonic/test/fixtures/independent-frame-alternatives.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject, writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) test(`independent frame alternatives preserve native aliases and callback identity in ${surfaces[0] ?? "native"}`,
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": independentFrameAlternativesSource } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`independent-frame-alternatives-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`independent-frame-cost-${surfaces[0] ?? "native"}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod independent_frame_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn independent_callback_retains_only_its_own_allocation() {
        let (independent, creation) = measure(|| independentRoot()${surfaces.length === 0 ? "" : ".unwrap()"});
        assert_eq!(creation.allocations, 2, "one class frame and one ordinary callback");
        assert_eq!(creation.deallocations, 1, "the unrelated frame releases before publication");
        assert_eq!(creation.reallocations, 0);
        let (result, invocation) = measure(|| independent.call((3.0,)).unwrap());
        assert_eq!(result, 31.0);
        assert_eq!(invocation, Cost::default());
        let (_, released) = measure(|| drop(independent));
        assert_eq!(released.deallocations, 1, "only the ordinary callback remained");
        assert_eq!(released.allocations, 0);
        assert_eq!(released.deallocated_bytes + creation.deallocated_bytes, creation.allocated_bytes);
    }

    #[test]
    fn retained_callback_has_no_adapter_allocation_or_strong_cycle() {
        let (retained, creation) = measure(retainedRoot);
        assert_eq!(creation.allocations, 1);
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
