import assert from "node:assert/strict";
import test from "node:test";
import { createRustProjectMethodDispatchPlanRegistry, instantiateRustProjectMethodDispatchArguments } from "../../../dist/analysis/project-types/method-dispatch.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { fakeAstReader } from "../../helpers/fake-compile-input.mjs";

function fixture() {
  const overload = { kindName: "KindMethodDeclaration", name: "read" };
  const implementation = { kindName: "KindMethodDeclaration", name: "read", body: {} };
  const abstract = { kindName: "KindMethodDeclaration", name: "required", abstract: true };
  const structural = { kindName: "KindMethodSignature", name: "read" };
  const missing = { kindName: "KindMethodDeclaration", name: "missing" };
  const owner = { declaration: {}, dispatchName: "OwnerDispatch", kind: "class" };
  const members = [overload, implementation, abstract, structural, missing];
  const ast = {
    ...fakeAstReader(),
    members: () => members,
    typeParameters: () => [],
    body: member => member.body,
    hasModifierKind: (member, kind) => kind === "abstract" && member.abstract === true,
  };
  const projectTypes = {
    definitions: [owner],
    isPolymorphic: () => true,
    definitionContainingDeclaration: member => members.includes(member) ? owner : undefined,
    concreteClassesFor: () => [],
    openCarrier: () => ({ kind: "target-named", id: "fixture.Owner" }),
    relationship: () => ({ kind: "related", targetType: { kind: "target-named", id: "fixture.Owner" } }),
    instantiateMemberCarrier: (_member, _receiver, carrier) => carrier,
    memberImplementation: (_owner, member) => member === overload
      ? { kind: "resolved", implementation: { declaration: implementation } } : { kind: "unrelated" },
    memberSlotName: (member, role) => `${members.indexOf(member)}_${role}`,
  };
  const input = { ast, projectTypes, names: { nameForDeclaration: member => member.name },
    sourceLifetimes: { parameterFor: () => undefined } };
  return { overload, implementation, abstract, structural, missing, input };
}

test("class overload declarations do not manufacture a second native method ABI", () => {
  const fixture_ = fixture();
  const registry = createRustProjectMethodDispatchPlanRegistry();
  const plan = registry.initialize(fixture_.input);
  assert.deepEqual(plan.variantsForMember(fixture_.overload), []);
  const selected = plan.variantsForMember(fixture_.implementation);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].declaration, fixture_.implementation);
  assert.ok(Object.isFrozen(selected));
  assert.ok(Object.isFrozen(selected[0]));
  assert.equal(plan.variantForMember(fixture_.overload, []), undefined);
  assert.equal(plan.variantForMember(fixture_.implementation, []), selected[0]);
});

test("abstract, structural and unresolved native contracts are not erased as overloads", () => {
  const fixture_ = fixture();
  const registry = createRustProjectMethodDispatchPlanRegistry();
  const plan = registry.initialize(fixture_.input);
  for (const member of [fixture_.abstract, fixture_.structural, fixture_.missing]) {
    assert.equal(plan.variantsForMember(member).length, 1);
  }
  const unknown = { kindName: "KindMethodDeclaration", name: "read" };
  assert.deepEqual(plan.variantsForMember(unknown), []);
});

test("overload elimination requires the exact owning concrete body, not name or a stale selection", () => {
  for (const mutate of [
    fixture_ => { fixture_.implementation.body = undefined; },
    fixture_ => { fixture_.input.projectTypes.definitionContainingDeclaration = () => ({ declaration: {} }); },
    fixture_ => { fixture_.input.projectTypes.memberImplementation = (_owner, member) => ({ kind: "resolved", implementation: { declaration: member } }); },
    fixture_ => { fixture_.input.projectTypes.memberImplementation = () => ({ kind: "unresolved" }); },
  ]) {
    const fixture_ = fixture();
    mutate(fixture_);
    const plan = createRustProjectMethodDispatchPlanRegistry().initialize(fixture_.input);
    assert.equal(plan.variantsForMember(fixture_.overload).length, 1);
  }
});

test("generic override specializations are transported through exact receiver-owner identity", () => {
  const baseType = { kind: "type-parameter", identity: "Base.Value", name: "Value" };
  const derivedType = { kind: "type-parameter", identity: "Derived.Item", name: "Item" };
  const genericBase = {};
  const genericDerived = {};
  const baseMethod = { kindName: "KindMethodDeclaration", name: "identity", parameters: [genericBase] };
  const derivedMethod = { kindName: "KindMethodDeclaration", name: "identity", parameters: [genericDerived] };
  const base = { declaration: {}, dispatchName: "BaseDispatch", typeParameterIdentities: [baseType.identity] };
  const derived = { declaration: {}, dispatchName: "DerivedDispatch", typeParameterIdentities: [derivedType.identity] };
  const carrier = definition => ({ kind: "target-named", id: definition.dispatchName });
  const projectTypes = {
    definitions: [base, derived],
    definitionContainingDeclaration: member => member === baseMethod ? base : member === derivedMethod ? derived : undefined,
    openCarrier: carrier,
    relationship: (receiver, owner) => receiver.id === owner.dispatchName || receiver.id === derived.dispatchName && owner === base
      ? { kind: "related", targetType: carrier(owner) } : { kind: "unrelated" },
    instantiateMemberCarrier: (member, receiver, argument) => substituteRustTargetTypeParameters(argument,
      member === baseMethod && receiver.id === derived.dispatchName
        ? new Map([[baseType.identity, derivedType]]) : new Map()),
    isPolymorphic: () => true,
    concreteClassesFor: owner => owner === base ? [base, derived] : [derived],
    memberImplementation: (owner, member) => ({ kind: "resolved", implementation: {
      declaration: owner === derived ? derivedMethod : member,
    } }),
    memberSlotName: (member, role) => `${member === baseMethod ? "base" : "derived"}_${role}`,
  };
  const ast = { ...fakeAstReader(),
    members: declaration => declaration === base.declaration ? [baseMethod] : [derivedMethod],
    typeParameters: member => member.parameters,
  };
  const sourceLifetimes = { parameterFor: parameter => ({ kind: "type", identity: parameter === genericBase ? "base.method" : "derived.method" }) };
  const registry = createRustProjectMethodDispatchPlanRegistry();
  assert.equal(registry.record(baseMethod, [baseType], ast, projectTypes, sourceLifetimes).kind, "accepted");
  const plan = registry.initialize({ ast, projectTypes, sourceLifetimes, names: { nameForDeclaration: member => member.name } });
  const baseVariant = plan.variantsForMember(baseMethod)[0];
  const derivedVariant = plan.variantsForMember(derivedMethod)[0];
  assert.equal(rustTargetTypeRefEquals(baseVariant.targetTypeArguments[0], baseType), true);
  assert.equal(rustTargetTypeRefEquals(derivedVariant.targetTypeArguments[0], derivedType), true);
  assert.equal(plan.variantForMember(baseMethod, [derivedType], carrier(derived)), baseVariant);
  assert.equal(plan.variantForMember(baseMethod, [baseType]), baseVariant);
  assert.equal(plan.variantForMember(derivedMethod, [baseType]), undefined);
  assert.equal(plan.variantForMember(derivedMethod, [derivedType]), derivedVariant);
  assert.equal(plan.variantForMember(baseMethod, [derivedType], { kind: "target-named", id: "Other" }), undefined);
  assert.equal(instantiateRustProjectMethodDispatchArguments({}, [], carrier(base), projectTypes), undefined);
  assert.equal(instantiateRustProjectMethodDispatchArguments(baseMethod, [, baseType], carrier(base), projectTypes), undefined);
});
