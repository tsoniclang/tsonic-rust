import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { nonReturningCallsSource } from "../../../../tsonic/test/fixtures/non-returning-calls.mjs";

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

test("guaranteed terminal operands complete statements before source completion is sealed", () => {
  const { program } = analyzeRust({ files: { "index.ts": nonReturningCallsSource + `
export function conditional(failed: boolean): void { failed && fail(); }
` } });
  const { ast } = program.source;
  const pending = [...program.sourceFiles];
  let terminalStatements = 0;
  let conditionalStatements = 0;
  while (pending.length !== 0) {
    const node = pending.pop();
    if (ast.is.IsExpressionStatement(node)) {
      const expression = ast.as.AsExpressionStatement(node).Expression;
      if (program.records.expressionExit.get(expression) !== undefined) {
        assert.equal(program.records.statementExit.get(node), true,
          "the existing guaranteed terminal operand is consumed by source statement completion");
        assert.equal(program.records.statementExit.get(ast.parent(node)), true,
          "an error-region body never receives a fabricated normal completion after its terminal operand");
        terminalStatements++;
      } else if (ast.is.IsBinaryExpression(expression) && ast.operatorKindName(expression) === "KindAmpersandAmpersandToken") {
        assert.equal(program.records.statementExit.get(node), false,
          "a conditionally evaluated terminal right operand does not terminate the complete statement");
        conditionalStatements++;
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  assert.equal(terminalStatements >= 2, true, "both synchronous and awaited terminal operands use the real producer");
  assert.equal(conditionalStatements, 1, "the actual conditional inverse is checked");
});

test("switch completion requires exact checked coverage and no exiting break", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function finite(value: "left" | "right"): void {
  switch (value) { case "left": return; case "right": return; }
}
export function missing(value: "left" | "right"): void {
  switch (value) { case "left": return; }
}
export function open(value: string): void {
  switch (value) { case "left": return; case "right": return; }
}
export function breaks(value: "left" | "right"): void {
  switch (value) { case "left": break; case "right": return; }
}
export function defaulted(value: string): void {
  switch (value) { case "left": return; default: return; }
}
` } });
  const { ast } = program.source;
  const expected = new Map([["finite", true], ["missing", false], ["open", false], ["breaks", false], ["defaulted", true]]);
  let observed = 0;
  for (const file of program.sourceFiles) {
    for (const declaration of ast.statements(file)) {
      if (declaration === undefined || !ast.is.IsFunctionDeclaration(declaration)) continue;
      const name = ast.text(ast.name(declaration));
      const body = ast.as.AsFunctionDeclaration(declaration).Body;
      assert.equal(program.records.statementExit.get(ast.statements(body)[0]), expected.get(name), name);
      assert.equal(program.records.statementExit.get(body), expected.get(name), name + ": exact body completion");
      observed++;
    }
  }
  assert.equal(observed, expected.size, "all finite, incomplete, open, break and default cases are checked");
});
