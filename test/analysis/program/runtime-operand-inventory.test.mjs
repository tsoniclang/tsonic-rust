import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRust } from "../../helpers/rust-session.mjs";

function analyzed(source, surfaces) {
  const result = analyzeRust({
    surfaces,
    target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": source },
  });
  assert.equal(result.program !== undefined, true,
    result.result.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
  return result.program;
}

function findNodes(program, predicate) {
  const nodes = [];
  const { ast } = program.source;
  const visit = node => {
    if (predicate(node, ast)) nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return nodes;
}

for (const surfaces of [[], ["js"]]) {
  const label = surfaces.length === 0 ? "native" : "js";
  test(`ordinary runtime values have prepared physical operands without turning definitions into reads (${label})`, () => {
    const program = analyzed("export function read(value: number): number { const copy = value; return copy + 1; }", surfaces);
    const values = findNodes(program, (node, ast) => ast.is.IsNumericLiteral(node) ||
      ast.is.IsIdentifier(node) && ["value", "copy"].includes(ast.text(node)) &&
      ast.name(ast.parent(node)) !== node);
    assert.equal(values.length >= 3, true, "the original source supplies identifier reads and a numeric literal");
    for (const node of values) {
      assert.equal(program.physicalEmissionContexts.operands.some(operand => operand.node === node), true,
        "every actual runtime value has its original prepared physical operand");
      assert.equal(program.ownership.reads.has(node), true, "each demanded runtime value has an ownership classification");
    }
    const definitions = findNodes(program, (node, ast) => ast.is.IsIdentifier(node) &&
      ["value", "copy"].includes(ast.text(node)) && ast.name(ast.parent(node)) === node);
    assert.equal(definitions.length, 2, "both authored declaration names remain in the semantic source domain");
    for (const node of definitions) assert.equal(program.ownership.reads.has(node), false,
      "an ordinary declaration name is not an emitted value read");
  });

  test(`an implicit parameter-property load retains its original native input occurrence (${label})`, () => {
    const program = analyzed("class Value { constructor(public current: number) {} } export function read(input: number): number { return new Value(input).current; }", surfaces);
    const [parameter] = findNodes(program, (node, ast) => ast.is.IsParameterDeclaration(node) &&
      ast.text(ast.name(node)) === "current");
    assert.equal(parameter !== undefined, true, "the constructor owns the original parameter property");
    const name = program.source.ast.name(parameter);
    assert.equal(program.physicalEmissionContexts.operands.some(operand =>
      operand.node === name && operand.use.role === "parameter-property"), true,
    "the implicit field initialization is an actual input use, not a fabricated expression");
    assert.equal(program.ownership.reads.has(name), true, "the original input read has complete physical ownership evidence");
  });
}
