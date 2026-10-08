import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { lexicalSelfBindingSource } from "../../../../tsonic/test/fixtures/lexical-self-binding.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`fixed self and written lexical bindings retain distinct native identities in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": lexicalSelfBindingSource } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    const emitted = artifactText(result, "src/index.rs");
    assert.equal(typeof emitted === "string", true, "actual source-to-native output");
    assert.match(emitted, /::recursive\(/u, "fixed named self uses the existing recursive native owner");
    assert.match(emitted, /binding_0: core::cell::OnceCell::new\(\)/u,
      "the native lexical frame owns exact once-only binding activation");
    assert.match(emitted, /binding_0\s*\.get\(\)[\s\S]*?\.replace\(field_value\)/u,
      "rebinding updates that same live frame slot");
    assert.doesNotMatch(emitted, /Location::uninitialized\(/u, "no second live-binding representation");
    validateGeneratedProject(`lexical-self-binding-${profile}`, result.artifacts, { run: true });
    const directory = writeGeneratedProject(`lexical-self-binding-drop-${profile}`, result.artifacts);
    appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod lexical_owner_drop {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn fixed_self_and_replaced_live_binding_release_all_native_owners() {
        for _ in 0..32 {
            let (result, cost) = measure(|| (fixedSelf().unwrap(), liveBinding().unwrap()));
            assert_eq!(result, (true, true));
            assert!(cost.allocations > 0);
            assert_eq!(cost.allocations, cost.deallocations);
            assert_eq!(cost.allocated_bytes, cost.deallocated_bytes);
            assert_eq!(cost.reallocations, 0);
        }
    }
}
`);
    const executed = runCargo(directory, ["test", "--release", "--", "--test-threads=1"]);
    assert.equal(executed.status, 0, executed.stdout.slice(-4096) + executed.stderr.slice(-4096));
  });
}
