import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { borrowedCallbackInputSource } from "../../../../tsonic/test/fixtures/borrowed-callback-inputs.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`selected callback inputs preserve native repeated mutation and readonly aliases (${profile})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": borrowedCallbackInputSource },
      target: { id: "rust", options: { outputType: "lib", crateName: "borrowed_callback_inputs" } } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n").slice(0, 6000));
    const root = writeGeneratedProject(`borrowed-callback-inputs-${profile}`, result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests", "inputs.rs"), profile === "native" ? nativeOwnershipCostSupport + `
use borrowed_callback_inputs::index;

#[test]
fn exact_borrowed_inputs_do_not_copy_or_allocate() {
    assert!(index::run().unwrap());
    let mut values = [1.0, 2.0];
    let (result, cost) = measure(|| index::twice(&mut values, |items: &mut [f64]| {
        items[0] += 1.0;
        Ok(items[0])
    }).unwrap());
    assert_eq!(result, 5.0);
    assert_eq!(values, [3.0, 2.0]);
    assert_eq!(cost, Cost::default());
    let (result, cost) = measure(|| index::observe(&values, |items: &[f64]| Ok(items[0])).unwrap());
    assert_eq!(result, 6.0);
    assert_eq!(cost, Cost::default());
}
` : `
#[test]
fn repeated_mutation_retains_the_same_backing_store() {
    assert!(borrowed_callback_inputs::index::run().unwrap());
}
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt", "--all"]);
    runCargo(root, ["fmt", "--all", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(root, ["test", "--release", "--locked", "--offline"]);
  });
}
