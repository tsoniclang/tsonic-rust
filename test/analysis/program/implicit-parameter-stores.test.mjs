import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

const source = `
class Unused { constructor(public seed: string) {} read(): string { return this.seed; } }
class FieldCapture { constructor(public seed: string) {} get = (): string => this.seed; }
class FieldRewrite { constructor(public seed: string) { this.seed = "other"; } }
class Retained {
  other: string;
  constructor(public seed: string) { this.other = seed; }
}
class LocalCapture {
  get: () => string;
  constructor(public seed: string) { this.get = (): string => seed; }
}
`;

for (const surfaces of [[], ["js"]]) {
  test(`implicit parameter storage separates moved inputs from retained local uses (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const { ast } = program.source;
    const observed = new Map();
    for (const definition of program.objectRepresentations.representations.map(value => value.definition)) {
      const constructor = ast.members(definition.declaration).find(node => ast.is.IsConstructorDeclaration(node));
      const parameters = [];
      ast.forEachChild(constructor, node => { if (ast.is.IsParameterDeclaration(node)) parameters.push(node); });
      assert.equal(parameters.length, 1);
      const name = ast.name(parameters[0]);
      const className = ast.text(ast.name(definition.declaration));
      observed.set(className, program.valueLifetimes.canMove(name));
    }
    assert.deepEqual([...observed], [["Unused", true], ["FieldCapture", true], ["FieldRewrite", true], ["Retained", false], ["LocalCapture", false]]);
  });
}
