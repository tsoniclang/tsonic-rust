import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

function fixture(outputType) {
  const { program } = analyzeRust({ surfaces: [],
    target: { id: "rust", options: { outputType } }, files: {
      "producer.ts": `
        export async function read(value: number): Promise<number> { return value; }
        export async function other(value: number): Promise<number> { return value; }
        export async function direct(value: number): Promise<number> { return value; }
        export function select(): typeof read { return read; }
      `,
      "index.ts": `
        import { direct, read, other, select } from "./producer.js";
        export async function main(): Promise<void> {
          const selected = select();
          if (selected !== read || selected === other) throw new Error("identity");
          if (await selected(7) !== 7 || await direct(9) !== 9) throw new Error("payload");
        }
        ${outputType === "bin" ? "await main();" : ""}
      `,
    },
  });
  const declarations = new Map();
  const ast = program.source.ast;
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.set(ast.text(ast.name(node)), node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return { program, declarations, reachability: program.reachability };
}

test("comparison-only declaration values do not invent invocation or body reachability", () => {
  const current = fixture("bin");
  const read = current.declarations.get("read");
  const other = current.declarations.get("other");
  const direct = current.declarations.get("direct");
  assert.equal(current.program.callableValues.genericDispatch.usesDeclarationBody(read), true);
  assert.equal(current.program.callableValues.genericDispatch.usesDeclarationBody(other), false);
  assert.equal(current.reachability.suppressedDeclarations.has(other), true,
    "existing authored-unused-body policy preserves native checking without a fake call");
  assert.equal(current.reachability.suppressedDeclarations.has(read), false);
  assert.equal(current.reachability.suppressedDeclarations.has(direct), false, "actual direct-call roots stay intact");
  for (const definition of current.program.callableValues.generic.physical.definitions()) {
    if (definition.members.every(member => member.implementation.declaration === other)) {
      assert.equal(current.program.callableValues.genericDispatch.requiredFor(definition), false);
    }
  }
});

test("library declaration roots remain externally reachable regardless of local identity-only use", () => {
  const current = fixture("lib");
  assert.equal(current.reachability.suppressedDeclarations.has(current.declarations.get("main")), false);
  assert.equal(current.reachability.externallyReachable.has(current.declarations.get("main")), true);
  assert.equal(Object.isFrozen(current.program.callableValues.genericDispatch), true);
  assert.equal(current.program.callableValues.genericDispatch.usesDeclarationBody({}), false);
});

for (const [name, body, retained] of [
  ["erased forwarding", "function unused() { return identity(value); } return 1;", false],
  ["live forwarding", "function used() { return identity(value); } await used(); return 1;", true],
  ["generated callable", "const selected = identity; await selected(value); return 1;", true],
]) {
  test(`native body reachability follows only the actual ${name} references`, () => {
    const { program } = analyzeRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
        async function identity<Value>(value: Value): Promise<Value> { return value; }
        async function consume(value: number): Promise<number> { ${body} }
        console.log(await consume(7));` } });
    assert.equal(program !== undefined, true, "the ordinary generic payload is native-admitted");
    const { ast } = program.source;
    let declaration;
    const visit = node => {
      if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "identity") declaration = node;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(declaration !== undefined, true, "the original generic declaration remains in the checked source");
    assert.equal(program.reachability.suppressedDeclarations.has(declaration), !retained,
      "normal and generated references both obey the one completed native-node domain");
  });
}
