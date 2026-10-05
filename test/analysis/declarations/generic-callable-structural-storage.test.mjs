import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { retainRustCallableStructuralStorage } from "../../../dist/policy/types/resolution/structural-instantiations.js";
import { rustGenericCallableProtocol, rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { resolveRustSelectedSourceCallResult, retainRustSelectedCallableResultTemplate } from "../../../dist/policy/types/resolution/call-results.js";
import { rustSourceTypeParameter } from "../../../dist/target-model/names/type-parameters.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture() {
  const declaration = {};
  const parameterDeclaration = {};
  const parameterType = {};
  const parameterSymbol = {};
  const sourceType = {};
  const sourceTypes = createRustSourceTypeRegistry();
  const parameter = { kind: "type-parameter", identity: "inner:Item", name: "Item" };
  const template = rustStructuralObjectTargetType("/factory.ts", [{
    sourceName: "value", type: parameter, presence: "required", readonly: false,
  }]);
  const fieldDeclaration = {};
  const fieldSymbol = {};
  const property = { type: parameterType, symbol: fieldSymbol, rootSymbols: [], optional: false, readonly: false };
  const member = { property, declarations: [fieldDeclaration], getters: [], setters: [], read: "property" };
  sourceTypes.registerStructuralObject({ sourceType, carrier: template, storage: "structural-object", fields: [{
    sourceName: "value", declarations: [fieldDeclaration], symbols: [fieldSymbol], sourceType: parameterType,
    resultCarrier: parameter, storageIndex: 0, presence: "required", readonly: false,
  }] });
  const correspondence = {
    kind: "available",
    source: { type: sourceType, calls: [], constructs: [], indexes: [] },
    destination: { type: sourceType, calls: [], constructs: [], indexes: [] },
    members: [{ kind: "present", source: member, destination: member }],
  };
  const semantics = {
    declarations: {
      declaredType: selected => selected === parameterDeclaration ? parameterType : undefined,
      typeSymbol: selected => selected === parameterType ? parameterSymbol : undefined,
      primarySymbolDeclaration: selected => selected === parameterSymbol ? parameterDeclaration : undefined,
    },
    types: {
      aliasApplication: () => undefined,
      structuralMembers: (source, destination) => {
        assert.equal(source === sourceType && destination === sourceType, true, "exact structural type owners");
        return correspondence;
      },
    },
  };
  const context = {
    ast: {
      kindName: () => "KindPropertySignature",
      typeNode: () => undefined,
      is: { IsMethodDeclaration: () => false },
    },
    currentSemantics: semantics,
    semanticsFor: () => semantics,
    sourceLifetimes: { contractFor: selected => selected === declaration ? {
      parameters: [{ kind: "type", declaration: parameterDeclaration }],
    } : undefined },
  };
  const callable = { parameters: [], result: { declaration, selectedType: sourceType } };
  const carrier = rustGenericCallableTargetType([parameter], [], template, {
    fileName: "/factory.ts", declarationIdentity: "factory:inner",
  });
  return { context, correspondence, semantics, sourceTypes, sourceType, template, carrier, callable,
    declaration, parameterDeclaration, parameterType,
    retain: () => retainRustCallableStructuralStorage(callable, [], template, carrier, context,
      { sourceTypes }, new Set()) };
}

test("callable normalization retains exact structural result correspondence for its native binder", () => {
  const input = fixture();
  assert.equal(input.retain(), true);
  const result = rustGenericCallableProtocol(input.carrier).result;
  const shape = input.sourceTypes.structuralObjectForType(input.sourceType, result);
  assert.equal(shape !== undefined, true, "normalized result has selected field evidence");
  assert.equal(shape.fields[0].resultCarrier.identity, "generic-callable:Call:0");
  assert.equal(rustStructuralObjectCarrierValue(input.template).fields[0].type.identity, "inner:Item");
  assert.equal(input.sourceTypes.structuralInstantiations().length, 1);
  assert.equal(input.retain(), true);
  assert.equal(input.sourceTypes.structuralInstantiations().length, 1);
});

function invocationFixture() {
  const input = fixture();
  const sourceFile = {};
  const name = {};
  Object.assign(input.context.ast, {
    name: selected => selected === input.parameterDeclaration ? name : undefined,
    text: selected => selected === name ? "Item" : "",
    getSourceFile: () => sourceFile,
    getPath: () => "/factory.ts",
    kind: () => 1,
    pos: () => 10,
    end: () => 14,
  });
  input.context.ast.is.IsTypeParameterDeclaration = selected => selected === input.parameterDeclaration;
  assert.equal(input.retain(), true, "creation owns its canonical structural protocol");
  const parameter = rustSourceTypeParameter(input.parameterDeclaration, input.context.ast);
  const template = rustGenericCallableProtocol(input.carrier, [parameter]).result;
  const integer = { kind: "source-primitive", name: "int64" };
  const resultType = {};
  const argumentType = {};
  const resultProperty = { ...input.correspondence.members[0].source.property, type: argumentType };
  const selectedCorrespondence = { ...input.correspondence,
    source: { ...input.correspondence.source, type: resultType },
    members: [{ ...input.correspondence.members[0], source: {
      ...input.correspondence.members[0].source, property: resultProperty,
    } }],
  };
  input.semantics.types.structuralMembers = (source, destination) => {
    assert.equal(source === resultType && (destination === input.sourceType || destination === resultType), true,
      "instantiated checker result and retained structural template have exact owners");
    return { ...selectedCorrespondence, destination: { ...selectedCorrespondence.destination, type: destination },
      members: selectedCorrespondence.members.map(member => destination === resultType
        ? { ...member, destination: member.source } : member) };
  };
  const selected = {
    sourceCallableCarrier: input.carrier,
    member: { parameters: [], returnType: template, genericParameters: [{ kind: "type", targetIdentity: parameter.identity }] },
    sourceReturnType: resultType,
    sourceSelectedMethodTypeArguments: [{ typeParameter: input.parameterType, selectedType: argumentType }],
    targetGenericArguments: [{ kind: "type", type: integer }],
  };
  return { ...input, correspondence: selectedCorrespondence, selected, parameter, integer, resultType };
}

test("stored callable invocation retains the native rebound template and its closed structural result", () => {
  const input = invocationFixture();
  const options = { sourceTypes: input.sourceTypes };
  assert.equal(retainRustSelectedCallableResultTemplate(input.selected, input.context, options), true);
  const template = input.sourceTypes.structuralObjectForType(input.resultType, input.selected.member.returnType);
  assert.equal(template !== undefined, true, "selected native invocation binder has exact field correspondence");
  assert.equal(rustTargetTypeRefEquals(template.fields[0].resultCarrier, input.parameter), true);
  const result = resolveRustSelectedSourceCallResult(input.selected, input.context, options);
  const shape = result === undefined ? undefined : input.sourceTypes.structuralObjectForType(input.resultType, result);
  assert.equal(shape !== undefined, true, "closed native invocation has exact field correspondence");
  assert.equal(rustTargetTypeRefEquals(shape.fields[0].resultCarrier, input.integer), true);
  assert.equal(rustStructuralObjectCarrierValue(input.template).fields[0].type.identity, "inner:Item");
});

test("stored callable invocation rejects foreign native binders, signatures and missing correspondence", () => {
  for (const mutate of [
    input => { input.selected.member.genericParameters[0].targetIdentity = "foreign:Item"; },
    input => { input.selected.member.genericParameters[0].kind = "lifetime"; },
    input => { input.selected.member.parameters = [{ type: input.integer }]; },
    input => { input.selected.member.returnType = input.integer; },
    input => { input.selected.sourceReturnType = undefined; },
    input => { input.context.currentSemantics.declarations.primarySymbolDeclaration = () => ({}); },
    input => { input.correspondence.members = []; },
  ]) {
    const input = invocationFixture();
    const originalCount = input.sourceTypes.structuralInstantiations().length;
    mutate(input);
    assert.equal(retainRustSelectedCallableResultTemplate(input.selected, input.context, { sourceTypes: input.sourceTypes }), false);
    assert.equal(input.sourceTypes.structuralInstantiations().length, originalCount,
      "rejected native invocation never publishes a rebound structural template");
  }
});

test("callable normalization rejects foreign binders and contradictory field correspondence", () => {
  for (const mutate of [
    input => { input.semantics.declarations.primarySymbolDeclaration = () => ({}); },
    input => { input.correspondence.members[0] = { ...input.correspondence.members[0],
      source: { ...input.correspondence.members[0].source,
        property: { ...input.correspondence.members[0].source.property, optional: true } } }; },
    input => { input.correspondence.members = []; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(input.retain(), false);
    assert.equal(input.sourceTypes.structuralInstantiations().length, 0);
  }
});
