import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { borrowedComparisonMutationSource, closedUnionEqualitySource } from "../../../../tsonic/test/fixtures/closed-union-equality.mjs";

test("closed union equality borrows exact payloads and preserves identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedUnionEqualitySource + '\nexport function main(): void { if (!run()) throw new Error("union equality"); }\nmain();\n' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const generated = artifactText(result, "src/index.rs");
  const path = generated.split("fn path(")[1]?.split(/\n(?:pub(?:\([^)]*\))? )?fn /u)[0];
  assert.ok(path !== undefined);
  assert.doesNotMatch(path, /\.clone\(|to_owned\(|to_string\(|Box::|JsValue/u);
  assert.match(path, /match /u);
  validateGeneratedProject("closed-union-equality", result.artifacts, { run: true });
});

test("closed union comparison preserves imported alias and callable identities", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "values.ts": closedUnionEqualitySource,
    "index.ts": 'import { run } from "./values.js"; export function main(): void { if (!run()) throw new Error("cross-file equality"); }\nmain();\n',
  } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("cross-file-union-equality", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  test(`comparison emission preserves selected snapshot and shared ownership (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": borrowedComparisonMutationSource +
      '\nexport function safe(left: string, right: string): boolean { return left === right; }\n' } });
    const selected = new Map();
    const visit = node => {
      const emission = program.records.binaryEmission.get(node);
      if (emission?.operator === "==" && program.source.ast.is.IsIdentifier(emission.left)) {
        const subject = program.source.ast.text(emission.left);
        if (subject === "value" || subject === "left") selected.set(subject, emission);
      }
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
    const mutating = selected.get("value");
    const stable = selected.get("left");
    assert.equal(mutating !== undefined, true, "the narrowed comparison is analyzed at its actual owner");
    assert.equal(stable !== undefined, true, "the pure comparison is analyzed at the same owner");
    const snapshot = program.records.readOwnership.get(mutating.left);
    assert.equal(snapshot?.value.kind, "clone", "a later same-owner mutation requires the first payload snapshot");
    assert.equal(snapshot.borrowedAcross.has(mutating.right), false, "the first payload is not leased across its replacement");
    assert.equal(mutating.leftShared, false, "emission cannot turn an owned snapshot back into a borrow");
    assert.equal(stable.leftShared, true, "a proven shared first operand remains zero-copy");
    assert.equal(stable.rightShared, true, "the proven shared second operand remains zero-copy");
  });

  test(`borrowed comparisons preserve the first value and release its owner before RHS mutation (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": borrowedComparisonMutationSource + '\nexport function main(): void { if (!run()) throw new Error("borrowed comparison mutation"); }\nmain();\n' } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`borrowed-comparison-mutation-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
