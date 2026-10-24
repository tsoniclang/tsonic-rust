import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosedValuesSource } from "../../../../tsonic/test/fixtures/native-closed-values.mjs";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";

for (const surfaces of [undefined, ["js"]]) {
  test(`nullish completion stays separate from an ordinary assignment value (${surfaces?.[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": nativeClosedValuesSource + `
export function ordinary(value: string, next: string): string { return value = next; }
` } });
    const { ast } = program.source;
    const pending = program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile);
    let nullish = 0;
    let ordinary = 0;
    while (pending.length !== 0) {
      const node = pending.pop();
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind === "nullish-assignment") {
        nullish++;
        const write = program.records.assignmentWrite.get(node);
        const evaluation = program.records.assignmentEvaluation.get(node);
        assert.equal(write !== undefined, true, "nullish storage keeps its exact native write plan");
        assert.equal(write.valueResult === undefined, true, "the internal store has no ordinary assignment completion");
        assert.equal(evaluation?.kind, "nullish", "nullish admission owns the present/fallback completion");
        assert.equal(evaluation.fact === operation, true, "completion retains the actual selected nullish operation");
        assert.equal(write.target === evaluation.left, true, "write and completion share the exact native target");
        assert.equal(write.value === evaluation.right, true, "write and completion share the exact fallback expression");
      } else if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindEqualsToken" &&
        ast.is.IsIdentifier(BinaryExpression_Left(ast, node)) && ast.text(BinaryExpression_Left(ast, node)) === "value" &&
        ast.is.IsIdentifier(BinaryExpression_Right(ast, node)) && ast.text(BinaryExpression_Right(ast, node)) === "next") {
        ordinary++;
        assert.equal(program.records.assignmentWrite.get(node)?.valueResult !== undefined, true,
          "an actual ordinary value assignment retains its required native completion");
      }
      pending.push(...ast.children(node));
    }
    assert.equal(nullish >= 4, true, "locals and effectful accessors are all admitted");
    assert.equal(ordinary, 1, "the ordinary assignment control is checked at the same producer");
  });

  test(`native closed values retain exact primitive, absence and shared-object operations in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": nativeClosedValuesSource + '\nexport function main(): void { if (!run()) throw new Error("native closed values"); }\nmain();\n' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = artifactText(result, "src/index.rs");
    if (surfaces === undefined) assert.match(source, /native_values_equal/u);
    assert.match(source, /from_shared_identity/u);
    assert.doesNotMatch(source, /TsValue::from_identity/u);
    if (surfaces === undefined) assert.doesNotMatch(source, /js_abi|tsonic_rust_js/u);
    validateGeneratedProject(`native-closed-values-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
