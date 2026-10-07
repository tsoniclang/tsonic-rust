import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`owned storage last uses move only the exact terminal RHS (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Holder { value = ""; }
export function terminal(text: string): Holder { const holder = new Holder(); holder.value = text; return holder; }
export function reused(text: string): Holder { const holder = new Holder(); holder.value = text; holder.value = text; return holder; }
export function repeated(text: string): Holder { const holder = new Holder(); for (let index = 0; index < 2; index++) holder.value = text; return holder; }
export function compound(text: string): Holder { const holder = new Holder(); holder.value += text; holder.value += text; return holder; }
` } });
    const { ast } = program.source;
    const observed = new Map();
    const visit = node => {
      if (ast.is.IsIdentifier(node) && ast.text(node) === "text") {
        const declaration = program.sourceNavigation.sourceReferenceFor(node)?.declaration;
        if (declaration !== undefined && ast.is.IsParameterDeclaration(declaration) && ast.name(declaration) !== node) {
          const owner = ast.parent(declaration);
          const name = ast.text(ast.name(owner));
          const previous = observed.get(name) ?? [];
          previous.push(program.valueLifetimes.canMove(node));
          observed.set(name, previous);
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) visit(file);
    assert.deepEqual([...observed], [["terminal", [true]], ["reused", [false, true]],
      ["repeated", [false]], ["compound", [false, false]]]);
  });
}
