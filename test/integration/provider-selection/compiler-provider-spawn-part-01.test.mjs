import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, artifactText, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { rustJsArrayLikeElementTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeNodeSpawnSource, incompatibleNodeStdioSource } from "../../../../tsonic/test/fixtures/native-node-spawn.mjs";

test("shared Node spawn proof preserves byte views, options and absent results", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "shared_provider_spawn" } },
    files: { "index.ts": (`${nativeNodeSpawnSource(process.execPath)}
      import { check } from "@acme/testing";
      export function main(): void { check(run()); }
    ` + "\nmain();\n") },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /JsArray::<core::convert::Infallible>/u);
  validateGeneratedProject("shared-provider-spawn", result.artifacts, { run: true });
});

test("empty provider argument producers retain the exact checked native element type", async () => {
  const { program } = analyzeRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": 'import { spawnSync } from "node:child_process"; export function run(): void { spawnSync("/missing/exact", []); }' } });
  const ast = program.source.ast;
  const literals = [];
  const visit = node => {
    if (ast.is.IsArrayLiteralExpression(node)) literals.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(literals.length, 1);
  const selected = program.records.runtimeCarrier.get(literals[0]);
  assert.equal(rustTargetTypeRefEquals(rustJsArrayLikeElementTargetType(selected?.carrier), rustStringTargetType()), true,
    "the source producer retains the selected string element, not an uninhabited fallback");
  assert.equal(program.records.runtimeCarrier.get(literals[0]) === selected, true,
    "repeated consumers read the same sealed producer evidence");
  assert.equal("set" in program.records, false, "consumers cannot replace sealed producer selections");
});
