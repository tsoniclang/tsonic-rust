import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { nativeFunction, nativeMethods } from "../../helpers/native-ast.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";

for (const [name, unused] of [
  ["direct erased capture", "function unused(): T { return value; }"],
  ["inherited erased capture", "function unused(): T { function referenced(): T { return value; } return referenced(); }"],
]) {
  test(`${name} cannot manufacture a native Clone or block a real transfer`, () => {
    const options = { files: { "index.ts": `
export function preserved<T>(value: T): T {
  const kept = value;
  ${unused}
  return kept;
}
` } };
    const { program } = analyzeRust(options);
    const { ast } = program.source;
    let erased;
    let transferred;
    const declarations = [];
    const visit = node => {
      if (ast.is.IsFunctionDeclaration(node)) declarations.push(node);
      if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "unused") erased = node;
      if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "kept") transferred = Node_Initializer(ast, node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(erased !== undefined && transferred !== undefined, true, "the original checked declarations are retained as evidence");
    assert.equal(program.records.nativeParticipation.get(erased), "erased", "the canonical early owner selected erasure");
    assert.equal(program.ownership.reads.get(transferred)?.value.kind, "move", "an erased capture is not a later native read");
    assert.equal(program.ownership.captures.has(erased), false, "erased code publishes no physical capture demand");
    for (const declaration of declarations.filter(node => ["unused", "referenced"].includes(ast.text(ast.name(node))))) {
      assert.equal(program.ownership.captures.has(declaration), false, "inherited erasure cannot resurrect an inner capture");
    }
    const { result } = compileRust(options);
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    const output = artifactText(result, "src/index.rs");
    assert.equal(nativeMethods(nativeFunction(result, "preserved"), "clone").length, 0, "the handwritten transfer needs no native clone");
    assert.doesNotMatch(output, /\bClone\b|\bunused\b|\breferenced\b/u, "erased source cannot impose a native representation or trait bound");
  });
}

test("a genuinely used nested capture retains the native duplication requirement", () => {
  const { result } = compileRust({ files: { "index.ts": `
export function retained<T>(value: T): [T, T] {
  const kept = value;
  function used(): T { return value; }
  return [kept, used()];
}
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /\bClone\b/u, "a real second owned use retains its inferred native bound");
  assert.equal(nativeMethods(nativeFunction(result, "retained"), "clone").length, 1,
    "the complete native ownership model performs the same one clone as (value.clone(), value)");
});
