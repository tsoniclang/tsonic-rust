import assert from "node:assert/strict";
import test from "node:test";
import { rustProjectObjectLayout } from "../../../dist/analysis/project-types/object-layout.js";

test("project layouts read only admitted leaf names and never partial computed fields", () => {
  const field = (kind, value) => ({ kind: "KindPropertySignature", name: { kind, value } });
  const members = [field("KindIdentifier", "count"), field("KindStringLiteral", "label"), field("KindNumericLiteral", "0")];
  const declaration = { kind: "KindInterfaceDeclaration", members };
  const ast = {
    kindName(node) { return node.kind; },
    members(node) { return node.members; },
    name(node) { return node.name; },
    text(node) {
      assert.notEqual(node.kind, "KindComputedPropertyName", "composite AST node text must not be queried");
      return node.value;
    },
  };
  const layout = rustProjectObjectLayout(declaration, ast);
  assert.deepEqual(layout.fields.map(({ sourceName, storageIndex }) => [sourceName, storageIndex]), [["count", 0], ["label", 1], ["0", 2]]);
  assert.deepEqual(layout.fields.map(({ declaration }) => declaration), members);
  assert.equal(rustProjectObjectLayout({ ...declaration, members: [...members, field("KindComputedPropertyName", undefined)] }, ast), undefined);
  assert.equal(rustProjectObjectLayout({ ...declaration, members: [...members, field("KindIdentifier", "count")] }, ast), undefined);
});
