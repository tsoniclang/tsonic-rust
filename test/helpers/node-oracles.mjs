import { nodeOraclePrograms, assertOracleOutput, runNodeOracle } from "../../../tsonic/test/fixtures/node-oracle/index.mjs";
import { compileRust, nodejsCapability } from "./rust-session.mjs";
import { validateGeneratedProject } from "./cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../tsonic/test/scripts/diagnostic-assertions.mjs";

export { nodeOraclePrograms, runNodeOracle };

export async function runNativeNodeOracle(program) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    capabilities: program.family === "streams" ? [await nodejsCapability()] : [],
    files: { "index.ts": program.source },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const executed = validateGeneratedProject(`node-oracle-${program.id}`, result.artifacts, { run: true });
  assertOracleOutput(program, "rust", executed.stdout);
  return executed.stdout;
}
