import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustProjectRootThisCarrier, analyzeRustProjectThisReferences } from "../../../dist/analysis/reachability/this-references.js";

function fixture() {
  const owner = { declaration: {} };
  const foreignOwner = { declaration: {} };
  const carrier = {};
  const selected = { kind: "KindThisKeyword", carrier };
  const foreign = { kind: "KindThisKeyword", carrier: {} };
  const absent = { kind: "KindThisExpression" };
  const method = { kind: "KindGetAccessor", children: [selected, foreign, absent] };
  const ast = { kindName: node => node.kind, hasModifierKind: node => node.static === true,
    forEachChild: (node, visitor) => node.children?.forEach(visitor) };
  const records = createRustRecordFixture({runtimeCarrier: { get: (node) => node.carrier === undefined ? undefined : { carrier: node.carrier } }});
  const projectTypes = {
    definitionForCarrier: selected => selected === undefined ? undefined : selected === carrier ? owner : foreignOwner,
    definitionContainingDeclaration: () => owner,
    openCarrier: selected => { assert.equal(selected === owner, true); return carrier; },
    isPolymorphic: selected => selected === owner,
  };
  return { owner, foreignOwner, carrier, selected, method, ast, records, projectTypes };
}

test("root receiver construction and expression overrides share exact this selection", () => {
  const input = fixture();
  const selection = analyzeRustProjectThisReferences(input.method, input.ast, input.records, input.projectTypes);
  const references = selection.get(input.owner.declaration);
  assert.equal(references.length, 1);
  assert.equal(references[0] === input.selected, true, "foreign or missing carrier identities never match");
  assert.equal(selection.get(input.foreignOwner.declaration).length, 1, "other native owners retain their own exact evidence");
  assert.equal(selection.get({}) === undefined, true, "an unrelated source declaration cannot borrow another owner's references");
  assert.equal(Object.isFrozen(references), true);
  assert.equal(rustProjectRootThisCarrier(input.method, input.ast, input.projectTypes,
    new Map([[input.method, selection]])) === input.carrier,
    true, "the actual wrapper construction is recorded");
  assert.equal(input.method.children.length, 3, "source evidence is not mutated");
});

test("a missing source receiver record fails at its analysis owner", () => {
  const input = fixture();
  assert.throws(() => rustProjectRootThisCarrier(input.method, input.ast, input.projectTypes, new Map()),
    /requires sealed receiver-reference evidence/u);
});

test("root this construction rejects static, constructor, non-polymorphic and unselected receivers", () => {
  for (const mode of ["static", "constructor", "direct", "missing-owner", "missing-this"]) {
    const input = fixture();
    if (mode === "static") input.method.static = true;
    if (mode === "constructor") input.method.kind = "KindConstructor";
    if (mode === "direct") input.projectTypes.isPolymorphic = () => false;
    if (mode === "missing-owner") input.projectTypes.definitionContainingDeclaration = () => undefined;
    if (mode === "missing-this") input.method.children = [];
    const selected = analyzeRustProjectThisReferences(input.method, input.ast, input.records, input.projectTypes);
    assert.equal(rustProjectRootThisCarrier(input.method, input.ast, input.projectTypes,
      new Map([[input.method, selected]])) === undefined, true, mode);
  }
  const input = fixture();
  input.projectTypes.definitionForCarrier = () => undefined;
  assert.equal(analyzeRustProjectThisReferences(input.method, input.ast, input.records, input.projectTypes).size,
    0, "two missing definitions are not an exact identity match");
});
