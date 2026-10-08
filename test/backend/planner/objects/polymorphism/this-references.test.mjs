import assert from "node:assert/strict";
import test from "node:test";
import { rustProjectRootThisCarrier, rustProjectThisReferences } from "../../../../../dist/backend/planner/objects/polymorphism/this-references.js";

function fixture() {
  const owner = {};
  const foreignOwner = {};
  const carrier = {};
  const selected = { kind: "KindThisKeyword", carrier };
  const foreign = { kind: "KindThisKeyword", carrier: {} };
  const absent = { kind: "KindThisExpression" };
  const method = { kind: "KindGetAccessor", children: [selected, foreign, absent] };
  const ast = { kindName: node => node.kind, hasModifierKind: node => node.static === true,
    forEachChild: (node, visitor) => node.children?.forEach(visitor) };
  const facts = { getRuntimeCarrierFact: node => node.carrier === undefined ? undefined : { carrier: node.carrier } };
  const projectTypes = {
    definitionForCarrier: selected => selected === undefined ? undefined : selected === carrier ? owner : foreignOwner,
    definitionContainingDeclaration: () => owner,
    openCarrier: selected => { assert.equal(selected === owner, true); return carrier; },
    isPolymorphic: selected => selected === owner,
  };
  return { owner, carrier, selected, method, ast, facts, projectTypes };
}

test("root receiver construction and expression overrides share exact this selection", () => {
  const input = fixture();
  const references = rustProjectThisReferences(input.method, input.carrier, input.ast, input.facts, input.projectTypes);
  assert.equal(references.length, 1);
  assert.equal(references[0] === input.selected, true, "foreign or missing carrier identities never match");
  assert.equal(rustProjectRootThisCarrier(input.method, input.ast, input.facts, input.projectTypes) === input.carrier,
    true, "the actual wrapper construction is recorded");
  assert.equal(input.method.children.length, 3, "source evidence is not mutated");
});

test("root this construction rejects static, constructor, non-polymorphic and unselected receivers", () => {
  for (const mode of ["static", "constructor", "direct", "missing-owner", "missing-this"]) {
    const input = fixture();
    if (mode === "static") input.method.static = true;
    if (mode === "constructor") input.method.kind = "KindConstructor";
    if (mode === "direct") input.projectTypes.isPolymorphic = () => false;
    if (mode === "missing-owner") input.projectTypes.definitionContainingDeclaration = () => undefined;
    if (mode === "missing-this") input.method.children = [];
    assert.equal(rustProjectRootThisCarrier(input.method, input.ast, input.facts, input.projectTypes), undefined);
  }
  const input = fixture();
  input.projectTypes.definitionForCarrier = () => undefined;
  assert.equal(rustProjectThisReferences(input.method, input.carrier, input.ast, input.facts, input.projectTypes).length,
    0, "two missing definitions are not an exact identity match");
});
