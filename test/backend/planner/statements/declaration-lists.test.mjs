import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { collectVariableDeclarations } from "../../../../dist/backend/planner/statements/resource-management.js";
import { analyzeRustResourceScopes } from "../../../../dist/analysis/control-flow/resource-scopes.js";
import { createRustResourceScopeProducer } from "../../../../dist/analysis/program/records/storage/resource-scopes.js";

function fixture() {
  const { program } = analyzeRust({ files: { "index.ts": `
export function run(): number {
  const first = (() => { const nested = 1; return nested; })(), second = 2;
  return first + second;
}
` } });
  const { ast } = program.source;
  const callable = ast.statements(program.sourceFiles[0]).find(ast.is.IsFunctionDeclaration);
  const statement = ast.statements(ast.body(callable))[0];
  const list = ast.as.AsVariableStatement(statement).DeclarationList;
  const declarations = ast.as.AsVariableDeclarationList(list).Declarations.Nodes;
  const nested = [];
  const visit = node => {
    if (ast.is.IsVariableDeclaration(node) && !declarations.includes(node)) nested.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(statement);
  assert.equal(declarations.length, 2, "both original direct bindings remain checked");
  assert.equal(nested.length, 1, "the actual initializer contains its separate nested binding");
  return { program, ast, statement, list, declarations, nested: nested[0],
    context: rustSourceFilePlanContext(program, statement) };
}

test("declaration collection retains only direct exact bindings", () => {
  const { statement, list, declarations: [first, second], nested, context } = fixture();
  for (const owner of [list, statement]) {
    const declarations = collectVariableDeclarations(owner, context);
    assert.equal(declarations.length, 2);
    assert.equal(declarations[0] === first, true);
    assert.equal(declarations[1] === second, true);
    assert.equal(declarations.includes(nested), false);
  }
  assert.equal(collectVariableDeclarations(first, context)[0] === first, true);
  assert.throws(() => collectVariableDeclarations(context.input.program.source.ast.as.AsVariableDeclaration(first).Initializer, context),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "Admitted variable syntax requires its exact declaration sequence.",
    "a non-variable call cannot acquire a fabricated empty variable declaration record");
});

test("declaration collection rejects sparse, foreign and accessor slots without evaluating them", () => {
  const { program, ast, list, declarations: [first] } = fixture();
  let evaluated = 0;
  const accessor = [];
  Object.defineProperty(accessor, "0", { get() { evaluated += 1; return first; } });
  const original = ast.as.AsVariableDeclarationList(list);
  const failures = [];
  for (const [index, declarations] of [undefined, [undefined], Array(1), [ast.name(first)], accessor].entries()) {
    const producer = createRustResourceScopeProducer(() => {});
    const selectedAst = { ...ast, as: { ...ast.as,
      AsVariableDeclarationList: node => node === list
        ? { ...original, Declarations: { ...original.Declarations, Nodes: declarations } }
        : ast.as.AsVariableDeclarationList(node) } };
    try {
      analyzeRustResourceScopes({ ast: selectedAst, nodes: [list], records: program.records, producer, required: [] });
      assert.equal(producer.records.variableDeclarations.get(list) === undefined, true,
        `original malformed declaration vector ${index}: no admission is published`);
    } catch (error) {
      failures.push({ vector: index, message: String(error.message).slice(0, 600) });
    }
  }
  assert.equal(evaluated, 0, "the original accessor must never execute during source admission");
  assert.deepEqual(failures, [], "all five original malformed declaration vectors reject at the actual source owner");
});
