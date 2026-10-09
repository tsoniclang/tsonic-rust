import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`closed indirect callbacks retain physical obligations without importing foreign source binders in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
interface Builder<Source> {
  edit<Key extends keyof Source>(owner: Source, key: Key, copy: (value: Source[Key]) => Source[Key]): () => Source[Key];
}
function create<Source>(): Builder<Source> {
  return { edit<Key extends keyof Source>(owner: Source, key: Key, copy: (value: Source[Key]) => Source[Key]): () => Source[Key] {
    return () => { owner[key] = copy(owner[key]); return owner[key]; };
  } };
}
export function main(): boolean {
  const owner = { count: 2, label: "ready" };
  const builder = create<typeof owner>();
  const count = builder.edit(owner, "count", value => value + 1);
  const label = builder.edit(owner, "label", value => value + "!");
  return count() === 3 && label() === "ready!";
}
` } });
    const { ast } = program.source;
    const declarations = [];
    const visit = node => {
      if (ast.is.IsFunctionDeclaration(node)) declarations.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
    const main = declarations.find(declaration => ast.text(ast.name(declaration)) === "main");
    const contract = program.declarationGenericRequirements.contractFor(main);
    assert.equal(contract !== undefined, true, "the calling declaration retains its exact contract");
    assert.equal(contract.typeParameters.length, 0);
    assert.equal(contract.capturedTypeParameters.length, 0);
    assert.equal(contract.associatedTypes.length, 0, "Source[Key] obligations belong to the implementation, not the closed invocation");
    assert.equal(contract.optionalStorage.length, 0);
  });
}
