import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const cases = [
  ["async-object-unit", `
async function fail(): Promise<void> { throw new Error("selected rejection"); }
const api = { async dispatch(): Promise<void> { await fail(); } };
export async function main(): Promise<void> {
  let caught = false;
  try { await api.dispatch(); } catch { caught = true; }
  if (!caught) throw new Error("async object method lost its rejection");
}
`],
  ["caught-record-contribution", `
interface Envelope { value: unknown; }
const failure = new Error("selected rejection");
function fail(): never { throw failure; }
function capture(): Envelope {
  try { fail(); } catch (error) { return { value: error }; }
}
export function main(): void {
  const result = capture();
  if (!(result.value instanceof Error) || result.value !== failure) {
    throw new Error("record contribution lost its error");
  }
}
`],
  ["caught-project-error", `
class Failure extends Error {}
interface Envelope { value: unknown; }
const failure = new Failure("selected rejection");
function fail(): never { throw failure; }
function capture(): Envelope {
  try { fail(); } catch (error) { return { value: error }; }
}
export function main(): void {
  const result = capture();
  if (!(result.value instanceof Error) || result.value !== failure) {
    throw new Error("project record contribution lost its error");
  }
}
`],
  ["caught-closed-payload", `
interface Envelope { value: unknown; }
const payload: unknown = "selected value";
function fail(): never { throw payload; }
function capture(): Envelope {
  try { fail(); } catch (error) { return { value: error }; }
}
export function main(): void {
  const result = capture();
  if (result.value instanceof Error || result.value !== payload) {
    throw new Error("non-Error record contribution changed its payload");
  }
}
`],
];

for (const surfaces of [[], ["js"]]) {
  for (const [name, source] of cases) {
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
            assert_eq!(actual.allocations, 0);
            assert_eq!(actual.reallocations, 0);
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
