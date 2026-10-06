import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { nativeErrorTransportCases } from "../../../../tsonic/test/fixtures/native-error-transport.mjs";

for (const surfaces of [[], ["js"]]) {
  for (const [name, source] of nativeErrorTransportCases) {
    test(`object-method Error owner ${name} (${surfaces[0] ?? "native"})`,
      { timeout: 300_000 }, () => {
        const { result } = compileRust({
          surfaces,
          target: { id: "rust", options: { outputType: "bin", crateName: name.replaceAll("-", "_") } },
          files: { "index.ts": source },
        });
        assert.equal(result.diagnostics.length, 0,
          result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
        validateGeneratedProject(name, result.artifacts, { run: true });
      });
  }
  test(`caught runtime Error admission has handwritten native allocation cost (${surfaces[0] ?? "native"})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "lib", crateName: "caught_error_cost" } },
        files: { "index.ts": `
export function admit(): unknown {
  try { throw new Error("selected rejection"); } catch (error) { return error; }
}
` },
      });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      const directory = writeGeneratedProject(`caught-error-cost-${surfaces[0] ?? "native"}`, result.artifacts);
      const ownerPath = surfaces.length === 0 ? "rt::TsValue" : "js_abi::JsValue";
      appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod program_error_cost {
    use super::*;
    use tsonic_rust_runtime::ErrorObject;
    ${nativeOwnershipCostSupport}

    #[test]
    fn transport_admission_has_native_error_cost() {
        for _ in 0..32 {
            let (_, actual) = measure(|| {
                let value = std::hint::black_box(admit());
                assert!(value.is_error());
                drop(value);
            });
            let (_, expected) = measure(|| {
                let error = tsonic_rust_runtime::TsonicError::from(
                    tsonic_rust_runtime::JsError::error("selected rejection"),
                );
                let value = std::hint::black_box(${ownerPath}::from_error(error));
                assert!(value.is_error());
                drop(value);
            });
            assert_eq!(actual, expected);
            assert_eq!(actual.allocations, actual.deallocations);
            assert_eq!(actual.allocated_bytes, actual.deallocated_bytes);
            assert_eq!(actual.reallocations, 0);

            let error = tsonic_rust_runtime::TsonicError::from(
                tsonic_rust_runtime::JsError::error("selected rejection"),
            );
            let identity = error.source_error().identity_key();
            let (value, admission) = measure(|| ${ownerPath}::from_error(error));
            assert_eq!(admission, Cost::default());
            assert_eq!(value.as_error().unwrap().error_identity_key(), identity);
            drop(value);
        }
    }
}
`);
      runCargo(directory, ["generate-lockfile", "--offline"]);
      runCargo(directory, ["fmt", "--all"]);
      runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    });
}
