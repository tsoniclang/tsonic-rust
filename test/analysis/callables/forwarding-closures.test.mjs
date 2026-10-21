import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

for (const [name, body, captured] of [
  ["exact argument order", "retain(first, second)", false],
  ["reversed argument order", "retain(second, first)", false],
  ["captured argument", "retain(captured, first)", true],
  ["effectful argument", "retain(next(), first)", false],
]) {
  test("source callable forwarding preserves " + name, () => {
    const { result } = compileRust({ files: { "index.ts": `
function retain(first: number, second: number): number { return first - second; }
function next(): number { return 7; }
function invoke(callback: (first: number, second: number) => number): number { return callback(2, 3); }
export function run(captured: number): number {
  const callback = (first: number, second: number): number => ${body};
  return invoke(callback);
}
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
    const program = result.program, ast = program.source.ast;
    const nodes = [];
    const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
    for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
    const closure = nodes.find(ast.is.IsArrowFunction);
    const fact = program.records.closureCapture.get(closure);
    assert.equal(fact !== undefined, true, "one source capture owner seals the callable environment");
    assert.equal(fact.captures.some(value => ast.text(ast.name(value.declaration)) === "captured"), captured,
      "only a checked authored capture becomes an environment field");
    const text = artifactText(result, "src/index.rs");
    assert.doesNotMatch(text, /Box::new|Rc::new|Arc::new|RefCell::new/u, "exact native forwarding requires no heap-erased callable");
    const expected = name === "reversed argument order" ? /retain\([^)]*second[^)]*first/u
      : name === "captured argument" ? /retain\([^)]*captured[^)]*first/u
      : name === "effectful argument" ? /next\(\)/u : /retain\([^)]*first[^)]*second/u;
    assert.match(text, expected, "native rendering keeps source argument order and effects");
  });
}
