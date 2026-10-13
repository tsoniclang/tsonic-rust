import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustPlannerLiveness } from "../../../../dist/backend/planner/liveness/plan.js";

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
  return { program, declarations, liveness: createRustPlannerLiveness(program) };
}

test("comparison-only declaration values do not invent invocation or body reachability", () => {
  const current = fixture("bin");
  const read = current.declarations.get("read");
  const other = current.declarations.get("other");
  const direct = current.declarations.get("direct");
  assert.equal(current.program.callableValues.genericDispatch.usesDeclarationBody(read), true);
  assert.equal(current.program.callableValues.genericDispatch.usesDeclarationBody(other), false);
  assert.equal(current.liveness.requiresSuppression(other), true,
    "existing authored-unused-body policy preserves native checking without a fake call");
  assert.equal(current.liveness.requiresSuppression(read), false);
  assert.equal(current.liveness.requiresSuppression(direct), false, "actual direct-call roots stay intact");
  for (const definition of current.program.callableValues.generic.physical.definitions()) {
    if (definition.members.every(member => member.implementation.declaration === other)) {
      assert.equal(current.program.callableValues.genericDispatch.requiredFor(definition), false);
    }
  }
});

test("library declaration roots remain externally reachable regardless of local identity-only use", () => {
  const current = fixture("lib");
  assert.equal(current.liveness.requiresSuppression(current.declarations.get("main")), false);
  assert.equal(current.liveness.isExternallyReachable(current.declarations.get("main")), true);
  assert.equal(Object.isFrozen(current.program.callableValues.genericDispatch), true);
  assert.equal(current.program.callableValues.genericDispatch.usesDeclarationBody({}), false);
});
