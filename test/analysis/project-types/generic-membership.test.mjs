import assert from "node:assert/strict";
import test from "node:test";
import { prepareRustProjectGenericMembership } from "../../../dist/analysis/project-types/generic-membership.js";

test("native project generic membership preserves exact source binders and scoped optional witnesses once", () => {
  const lifetime = Object.freeze({ kind: "parameter", identity: "owner:life", name: "life" });
  const named = Object.freeze({ kind: "lifetime", declaration: {}, lifetime, outlives: [] });
  const value = Object.freeze({ kind: "type", declaration: {}, identity: "owner:Value", targetName: "Value", outlives: [] });
  const other = Object.freeze({ kind: "type", declaration: {}, identity: "owner:Other", targetName: "Other", outlives: [] });
  const valueCarrier = Object.freeze({ kind: "type-parameter", identity: value.identity, name: value.targetName });
  const otherCarrier = Object.freeze({ kind: "type-parameter", identity: other.identity, name: other.targetName });
  const definition = Object.freeze({ declaration: {}, genericParameters: [named, value, other] });
  const optional = Object.freeze({ captured: false, carrier: { kind: "type-parameter", identity: "optional:Value",
    name: "OptionalValue", optionalStorageValue: valueCarrier }, requirements: ["clone"] });
  const unrelated = Object.freeze({ ...optional, carrier: { ...optional.carrier, identity: "optional:Other", optionalStorageValue: otherCarrier } });
  const captured = Object.freeze({ ...optional, captured: true });
  const requirements = Object.freeze(["clone", "static"]);
  const contract = Object.freeze({ typeParameters: [{ identity: value.identity, requirements },
    { identity: other.identity, requirements: ["copy"] }], optionalStorage: [optional, unrelated, captured] });
  let reads = 0;
  const owner = prepareRustProjectGenericMembership({ contractFor: declaration => {
    reads++;
    return declaration === definition.declaration ? contract : undefined;
  } });
  const indexes = [0, 1];
  const selected = owner.forDeclaration(definition, indexes);
  assert.equal(selected.parameters.length, 2, "only the selected native environment binders are published");
  assert.equal(selected.parameters[0].parameter === named && selected.parameters[1].parameter === value, true,
    "original source lifetime and type binder identities remain ordered");
  assert.equal(selected.parameters[1].requirements === requirements, true, "the original complete native requirements are retained");
  assert.equal(selected.optionalStorage.length, 1, "captured and out-of-scope optional witnesses are excluded at their owner");
  assert.equal(selected.optionalStorage[0] === optional, true, "the selected optional witness keeps its exact original contract");
  assert.equal(owner.forDeclaration(definition, [0, 1]) === selected, true, "equivalent actual placements select once");
  assert.equal(reads, 1, "late bound emission cannot recompute membership from the declaration contract");
  indexes[1] = 2;
  assert.equal(selected.parameters[1].parameter === value, true, "mutating the request container cannot alter selected membership");
  assert.equal(owner.forDeclaration(definition, indexes).optionalStorage[0] === unrelated, true,
    "a distinct actual environment owns its distinct exact optional witness");
  assert.equal(selected.inScope({ kind: "reference", referent: valueCarrier, mutable: false, lifetime }), true,
    "the actual selected named lifetime and payload remain in scope");
  assert.equal(selected.inScope({ kind: "reference", referent: valueCarrier, mutable: false,
    lifetime: { ...lifetime, identity: "foreign:life" } }), false, "a same-spelled foreign lifetime cannot enter the native header");
  assert.equal(selected.inScope(otherCarrier), false, "a nonselected source generic is not available by name");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.parameters) && Object.isFrozen(selected.optionalStorage), true,
    "late publication consumes immutable selected membership");
  assert.throws(() => owner.forDeclaration({ ...definition, declaration: {} }, [0]), /complete generic contract/u,
    "a foreign original declaration cannot borrow a same-shaped native contract");
  assert.throws(() => owner.forDeclaration(definition, [3]), /outside its declaration/u,
    "an unavailable actual binder is never replaced by another source parameter");
});
