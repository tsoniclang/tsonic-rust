import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

function declarations(program) {
  const result = [];
  const ast = program.source.ast;
  const visit = node => {
    if (ast.is.IsVariableDeclaration(node)) result.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  return result;
}

test("source liveness removes unnecessary mutability and retains required native writes", () => {
  const { result } = compileRust({ files: { "index.ts": `
export function immutable(input: number): number { let stable = input; return stable; }
export function mutable(input: number): number { let changing = input; changing = changing + 1; return changing; }
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
  const program = result.program;
  for (const [name, mutable] of [["stable", false], ["changing", true]]) {
    const declaration = declarations(program).find(node => program.source.ast.text(program.source.ast.name(node)) === name);
    assert.equal(declaration !== undefined, true, name + ": exact checked binding");
    assert.equal(program.records.localBinding.get(declaration).mutable, mutable, name + ": one pre-seal native mutability decision");
  }
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /let mut stable/u, "an authored let alone never causes unused_mut");
  assert.match(source, /let mut changing/u, "a required native write retains mutable storage");
  assert.doesNotMatch(source, /allow\(unused_mut\)/u, "the output does not hide an unnecessary mutable binding");
});

test("unobserved native writes retain the exact expectation and RHS effect", () => {
  const { result } = compileRust({ files: { "index.ts": `
function effect(): number { return 7; }
export function run(input: number): number { let marker = input; marker = effect(); return 0; }
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
  const program = result.program;
  const declaration = declarations(program).find(node => program.source.ast.text(program.source.ast.name(node)) === "marker");
  assert.equal(program.records.bindingLiveness.get(declaration).unusedInitializer, true, "the exact source initializer is unobserved");
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /expect\(unused_assignments, reason = "checked source evaluation order"\)/u, "the source-selected dead write keeps its native warning disposition");
  const body = source.slice(source.indexOf("pub fn run"));
  assert.equal((body.match(/effect\(\)/gu) ?? []).length, 1, "dead storage never drops or repeats its RHS effect");
});

test("terminal authored bindings retain one evaluation and their native lexical scope", () => {
  const { result } = compileRust({ files: { "index.ts": `
function acquire(): number { return 7; }
export function run(): number { const result = acquire(); return result; }
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
  const source = artifactText(result, "src/index.rs");
  const body = source.slice(source.indexOf("pub fn run"));
  assert.equal((body.match(/acquire\(\)/gu) ?? []).length, 1, "the authored terminal initializer is evaluated exactly once");
  assert.match(body, /let result[^;]*acquire\(\);/u, "the authored binding remains in its original native scope");
  assert.match(body, /return result;/u, "the exact initialized value reaches the source return");
  assert.doesNotMatch(body, /Box::new|Rc::new|Arc::new|\.clone\(/u, "retaining a lexical binding introduces no allocation or copy");
});
