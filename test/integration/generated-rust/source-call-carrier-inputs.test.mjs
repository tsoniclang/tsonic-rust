import assert from "node:assert/strict";
import test from "node:test";
import { sourceCallCarrierInputs } from "../../../../tsonic/test/fixtures/source-call-carrier-inputs.mjs";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("source-call inputs retain exact native-width integer carriers", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "lib", crateName: "source_call_carriers" } },
    files: { "index.ts": sourceCallCarrierInputs } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n").slice(0, 6000));
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.equal(/usize_to_f64|u64_to_f64|as f64|9007199254740992/u.test(output), false);
  const root = writeGeneratedProject("source-call-carrier-inputs", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests", "carriers.rs"), nativeOwnershipCostSupport + `
use source_call_carriers::index;

#[test]
fn native_inputs_execute_without_allocation_or_floating_carriers() {
    assert!(index::run().unwrap());
    let text = String::from("retained input");
    let (length, cost) = measure(|| index::textOffset(std::hint::black_box(&text)).unwrap());
    assert_eq!(length, text.len() as u64);
    assert_eq!(cost, Cost::default());
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
});
