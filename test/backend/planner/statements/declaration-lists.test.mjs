import assert from "node:assert/strict";
import test from "node:test";
import { collectVariableDeclarations } from "../../../../dist/backend/planner/statements/resources.js";

function context() {
  return { input: { program: { source: { ast: {
    kindName: node => node?.kind ?? "",
    is: {
      IsVariableDeclarationList: node => node?.kind === "KindVariableDeclarationList",
      IsVariableStatement: node => node?.kind === "KindVariableStatement",
    },
    as: {
      AsVariableStatement: node => ({ DeclarationList: node.list }),
      AsVariableDeclarationList: node => ({ Declarations: { Nodes: node.declarations } }),
    },
    forEachChild() { throw new Error("declaration lists must not traverse nested bodies"); },
  } } } } };
}

test("declaration collection retains only direct exact bindings", () => {
  const nested = { kind: "KindVariableDeclaration" };
  const first = { kind: "KindVariableDeclaration", initializer: { nested } };
  const second = { kind: "KindVariableDeclaration" };
  const list = { kind: "KindVariableDeclarationList", declarations: [first, second] };
  const statement = { kind: "KindVariableStatement", list };
  for (const owner of [list, statement]) {
    const declarations = collectVariableDeclarations(owner, context());
    assert.equal(declarations.length, 2);
    assert.equal(declarations[0] === first, true);
    assert.equal(declarations[1] === second, true);
    assert.equal(declarations.includes(nested), false);
  }
  assert.equal(collectVariableDeclarations(first, context())[0] === first, true);
  assert.equal(collectVariableDeclarations({ kind: "KindCallExpression", nested }, context()).length, 0);
});

test("declaration collection rejects sparse, foreign and accessor slots without evaluating them", () => {
  let evaluated = 0;
  const accessor = [];
  Object.defineProperty(accessor, "0", { get() { evaluated += 1; return { kind: "KindVariableDeclaration" }; } });
  for (const declarations of [undefined, [undefined], Array(1), [{ kind: "KindIdentifier" }], accessor]) {
    const list = { kind: "KindVariableDeclarationList", declarations };
    assert.equal(collectVariableDeclarations(list, context()).length, 0);
  }
  assert.equal(evaluated, 0);
});
