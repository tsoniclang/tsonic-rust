import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { loopCaptureStorageSource } from "../../../../tsonic/test/fixtures/loop-capture-storage.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`lexical loop activations retain copied and live captures in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": loopCaptureStorageSource } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`loop-capture-storage-${profile}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`loop-capture-storage-drop-${profile}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod iteration_owner_drop {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn every_completed_activation_releases_all_native_owners() {
        for _ in 0..32 {
            let (result, cost) = measure(|| run().unwrap());
            assert!(result);
            assert_eq!(cost.allocations, cost.deallocations);
            assert_eq!(cost.allocated_bytes, cost.deallocated_bytes);
            assert_eq!(cost.reallocations, 0);
        }
    }

    #[test]
    fn immutable_iteration_captures_do_not_allocate_a_binding_owner() {
        let (result, cost) = measure(|| copiedIterations().unwrap());
        assert!(result);
        assert_eq!(cost.allocations, 3);
        assert_eq!(cost.allocations, cost.deallocations);
        assert_eq!(cost.allocated_bytes, cost.deallocated_bytes);
        assert_eq!(cost.reallocations, 0);
    }
}
`);
    const executed = runCargo(directory, ["test", "--release", "--", "--test-threads=1"]);
    assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
  });
}
