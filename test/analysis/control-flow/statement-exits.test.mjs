import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

test("source completion is sealed for returns, exhaustive branches and deferred callable bodies", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function exhaustive(value: boolean): number { if (value) { return 1; } else { return 2; } }
export function partial(value: boolean): number { if (value) { return 1; } return 2; }
export function deferred(value: number): number { const callback = (): number => { return value; }; return callback(); }
export function switched(value: "left" | "right"): number {
  switch (value) { case "left": return 1; case "right": return 2; }
}
export function itemOnly(value: number): number { function helper(): number { return value; } return helper(); }
` } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  const declaration = name => nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
  const body = name => ast.as.AsFunctionDeclaration(declaration(name)).Body;
  for (const name of ["exhaustive", "partial", "deferred", "switched", "itemOnly"]) {
    assert.equal(program.records.statementExit.get(body(name)), true, name + ": the function has no normal fallthrough");
  }
  const first = name => ast.statements(body(name))[0];
  assert.equal(program.records.statementExit.get(first("exhaustive")), true, "both return branches exit");
  assert.equal(program.records.statementExit.get(first("partial")), false, "one return branch still falls through");
  assert.equal(program.records.statementExit.get(first("deferred")), false, "constructing a closure does not execute its return");
  assert.equal(program.records.statementExit.get(first("switched")), true, "checked exhaustive switch has no fabricated fallthrough");
  assert.equal(program.records.statementExit.get(first("itemOnly")), false, "a nested callable declaration is not an executed return");
  assert.equal(program.records.statementExit.get({}), undefined, "no source identity is inferred from object shape");
});
