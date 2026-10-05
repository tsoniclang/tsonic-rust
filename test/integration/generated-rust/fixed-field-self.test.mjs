import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { fixedFieldSelfSource } from "../../helpers/fixed-field-self.mjs";

for (const surfaces of [[], ["js"]]) test(`escaped fixed field self releases the last native owner in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
  const profile = surfaces[0] ?? "native";
  const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": fixedFieldSelfSource } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
  const emitted = artifactText(result, "src/index.rs");
  assert.equal(typeof emitted === "string", true, "actual native source is produced");
  assert.equal(emitted.includes("::recursive("), true);
  assert.equal(/captured_field|OnceCell|RefCell|Location::uninitialized/u.test(emitted), false);
  validateGeneratedProject(`fixed-field-self-${profile}`, result.artifacts, { run: true });
  const directory = writeGeneratedProject(`fixed-field-self-cost-${profile}`, result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod fixed_field_owner_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn distinct_escaped_entries_have_only_their_own_allocation_and_release_it() {
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
