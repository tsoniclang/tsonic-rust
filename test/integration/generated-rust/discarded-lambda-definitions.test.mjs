import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { discardedCallableDefinitionsSource, retainedDefaultCallableSource } from "../../../../tsonic/test/fixtures/discarded-callable-definitions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`discarded definitions preserve captured initialization, invoked effects and zero native allocation (${lane})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": discardedCallableDefinitionsSource + '\nexport function main(): void { if (!run()) throw new Error("discarded definition effects"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const directory = writeGeneratedProject(`discarded-lambda-definitions-${lane}`, result.artifacts);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["fmt", "--all", "--check"]);
    appendFileSync(join(directory, "src/index.rs"), `\n#[cfg(test)]\nmod discarded_definition_cost {\nuse super::*;\n${nativeOwnershipCostSupport}
      #[test]
      fn uninvoked_definitions_do_not_allocate() {
          let (sum, cost) = measure(|| (0..10000).map(|value| discarded(f64::from(value))).sum::<f64>());
          assert_eq!(sum, 49995000.0);
          assert_eq!(cost, Cost::default());
      }
    }\n`);
    runCargo(directory, ["fmt", "--all"]);
    runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    runCargo(directory, ["run", "--release", "--locked", "--offline"]);
  });
  test(`discarded definitions still require valid source body checking (${lane})`, () => {
    assert.throws(() => compileRust({ surfaces, files: { "index.ts": `export function run(): boolean { (() => missingIdentifier); return true; }` } }),
      /Cannot find name.*missingIdentifier/u, "discard does not suppress source errors");
  });
  test(`an absence default retains and invokes its required lambda (${lane})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": retainedDefaultCallableSource + '\nexport function main(): void { if (!run()) throw new Error("retained default effects"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const directory = writeGeneratedProject(`retained-default-lambda-${lane}`, result.artifacts);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["fmt", "--all", "--check"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["run", "--release", "--locked", "--offline"]);
  });
}
