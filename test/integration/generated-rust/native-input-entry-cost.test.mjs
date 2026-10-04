import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { nativeRetainedErrorSourceFor } from "../../../../tsonic/test/fixtures/native-retained-errors.mjs";

test("exact native Error entry conversion adds no allocation or copied payload", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "lib", crateName: "native_input_entry_cost" } },
    files: { "index.ts": nativeRetainedErrorSourceFor("annotated", "binding") } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
  const directory = writeGeneratedProject("native-input-entry-cost", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/cost.rs"), `${nativeOwnershipCostSupport}
use native_input_entry_cost::program::SourceError;
use tsonic_rust_runtime::{JsError, RetainedError};

#[test]
fn entry_matches_native_transport_cost() {
    let input = RetainedError::from(JsError::error("original retained payload"));
    let (_, native) = measure(|| {
        for _ in 0..10_000 {
            std::hint::black_box(input.clone());
        }
    });
    let (_, generated) = measure(|| {
        for _ in 0..10_000 {
            std::hint::black_box(SourceError::from(input.clone()));
        }
    });
    assert_eq!(native, generated);
    assert_eq!(generated, Cost::default());
}
`);
  runCargo(directory, ["test", "--offline", "--quiet", "--test", "cost"]);
});
