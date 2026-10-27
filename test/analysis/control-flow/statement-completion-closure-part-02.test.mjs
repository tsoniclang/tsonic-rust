import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, artifactText, acmePlatformPackage, acmeTestingPackage, boolCarrier, unitCarrier } from "../../helpers/rust-session.mjs";
import { analyzeRustStatementCompletions, rustRuntimeSetSourceInputs } from "../../../dist/analysis/control-flow/statement-completion.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustNativeFixtureNodes } from "../../helpers/records.mjs";
import { createRustStatementCompletionProducer } from "../../../dist/analysis/program/records/operations/statement-completion.js";
import { createRustDirectStorageProducer } from "../../../dist/analysis/program/records/storage/direct-storage.js";
import {
  statementQueries,
  statementIndex,
  checkedGuardNodes,
  diagnosticSourceLabel,
  source,
  checked,
  select,
} from "./statement-completion-closure-fixtures.mjs";

test("caught fallible native iteration uses the protected body without widening its callable error ABI", () => {
  const nativeSource = `
import { check } from "@acme/testing";
export function run(): number {
  let count = 0;
  try { for (const match of "aa".matchAll(/a/g)) { if (match.length > 0) count += 1; } } catch {}
  return count;
}
export function main(): void { check(run() === 2); }
main();
`;
  const packages = [acmeTestingPackage()];
  const { program, nodes, ast } = checked(nativeSource, { surfaces: ["js"], packages });
  const callable = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "run");
  const iteration = nodes.find(ast.is.IsForOfStatement);
  assert.equal(program.records.targetOperation.get(iteration)?.lowering.kind, "fallible-owned",
    "the real native RegExp iteration retains its fallible protocol");
  assert.equal(program.errorRegions.get(callable)?.kind, "infallible", "the catch keeps the outward ABI infallible");
  assert.equal(statementIndex(program.records).iterationFor(iteration) !== undefined, true,
    "the actual protected iteration is admitted before publication");
  const { result } = compileRust({ surfaces: ["js"], packages,
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_caught_fallible_iteration" } },
    files: { "index.ts": nativeSource } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-caught-fallible-iteration", result.artifacts, { run: true });
});
