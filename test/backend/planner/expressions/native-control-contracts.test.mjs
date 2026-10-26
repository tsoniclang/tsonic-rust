import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../../helpers/rust-session.mjs";
import { planRustNativeControl } from "../../../../dist/backend/planner/expressions/native-controls.js";

// The native propagation fact is produced only by the analysis owner (analysis/operations/native-controls.ts), which
// refuses an operand or enclosing callable without the exact Result contract. The planner renders the sealed fact.
test("native propagation validates sealed operand, result and authored callable boundary", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Result } from "@tsonic/rust/core/result.js";
import { propagate } from "@tsonic/rust/lang.js";
export function forward(value: Result<int32, int32>): Result<int32, int32> {
  return Result.Ok<int32, int32>(propagate(value));
}
` } });
  const { ast } = program.source;
  const propagations = [];
  const visit = node => {
    if (program.records.targetOperation.get(node)?.kind === "native-propagation") propagations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(propagations.length, 1);
  const node = propagations[0];
  const fact = program.records.targetOperation.get(node);
  assert.equal(fact.operandExpression, ast.arguments(node)[0]);
  assert.equal(ast.is.IsFunctionDeclaration(fact.callableDeclaration), true);
  const context = callableDeclaration => ({ input: { program }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, callableDeclaration,
    moduleName: "index", usedAliases: new Set(), moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(), structuralShapesModuleName: "shapes" });
  const selected = context(fact.callableDeclaration);
  const planned = planRustNativeControl(node, fact, selected, () => ({ kind: "path", path: "value" }));
  assert.equal(planned.kind, "try");
  assert.equal(planned.nativeReturn, true);
  assert.equal(selected.diagnostics.length, 0);
  // A sealed propagation planned outside its authored callable is a corrupt emission context.
  assert.throws(() => planRustNativeControl(node, fact, context(node), () => ({ kind: "path", path: "value" })),
    /selected callable emission context/u);

  // An enclosing callable or closure without the operand's Result contract is refused before emission.
  const { result } = compileRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Result } from "@tsonic/rust/core/result.js";
import { propagate } from "@tsonic/rust/lang.js";
export function scalar(value: Result<int32, int32>): int32 { return propagate(value); }
export function closure(value: Result<int32, int32>): int32 {
  const read = (): int32 => propagate(value);
  return read();
}
` } });
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.filter(diagnostic => diagnostic.code === "RUST_NATIVE_CONTROL_CONTRACT_REQUIRED").length, 2);
});
