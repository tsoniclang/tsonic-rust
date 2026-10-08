import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`generated rest dispatch retains only its actual native element requirement in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      interface Head<T> { head(...values: T[]): T; }
      class First<T> implements Head<T> { head(first: T, ...rest: T[]): T { return first; } }
      class Ordinary<T> { head(first: T): T { return first; } }
      export function main(): void {
        const head: Head<string> = new First<string>();
        head.head("first");
        new Ordinary<string>().head("direct");
      }
    ` } });
    const byName = new Map(program.projectTypes.definitions.map(definition => [definition.targetPath, definition]));
    const requiresClone = name => program.declarationGenericRequirements.contractFor(byName.get(name).declaration)
      .typeParameters.some(parameter => parameter.requirements.includes("clone"));
    assert.equal(requiresClone("First"), surfaces.length !== 0,
      "only shared rest extraction requires cloning its owned element");
    assert.equal(requiresClone("Ordinary"), false, "an ordinary moved parameter remains unconstrained");
  });
}
