import assert from "node:assert/strict";
import test from "node:test";
import { sourcePrimitiveFactKey } from "@tsonic/tsts";
import { resolveProjectSourceCarrier } from "../../../dist/policy/types/resolution/project.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function selfReference({ generic = false, optional = true } = {}) {
  const symbol = Object.freeze({});
  const declaration = Object.freeze({});
  const selectedType = Object.freeze({});
  const apparent = Object.freeze({});
  const argumentType = Object.freeze({});
  const argumentSymbol = Object.freeze({});
  const method = Object.freeze({});
  const parameter = Object.freeze({});
  const parameters = generic ? [{ kind: "type", declaration: parameter, identity: "/self.ts:Value", targetName: "Value" }] : [];
  const carrier = rustSourceTypeCarrier("/self.ts", "Fluent", "object");
  const types = {
    isNonPrimitive: () => false,
    isTypeReference: type => type === apparent,
    apparentType: type => type === selectedType ? apparent : type,
    effectiveTypeArguments: type => type === apparent ? generic ? [argumentType] : [] : [],
    typeArgumentBindings: type => {
      const arguments_ = types.effectiveTypeArguments(type);
      return arguments_?.map((argumentType, index) => ({ scope: "local", declaration: parameters[index]?.declaration, argumentType }));
    },
    aliasApplication: () => undefined,
    typeReferenceTarget: () => undefined,
    propertyInfos: () => optional ? [{ optional: true, symbol: method }] : [],
    indexInfos: () => [],
    constructSignatures: () => [],
    signatureInfos: () => [],
  };
  const declarations = {
    symbolDeclarations: selected => selected === symbol ? [declaration] : selected === method ? [method] : [],
    typeSymbol: type => type === argumentType ? argumentSymbol : type === selectedType || type === apparent ? symbol : undefined,
    typeAliasSymbol: () => undefined,
    declaredType: () => apparent,
  };
  const semantics = { types, declarations, facts: { typeSubjects: () => [] } };
  const context = {
    currentSemantics: semantics,
    semanticsFor: () => semantics,
    source: { navigation: { isProjectDeclaration: node => node === declaration },
      sourceFacts: { getFact: () => undefined } },
    sourceLifetimes: { contractFor: () => ({ parameters }) },
    facts: { get: (subject, key) => subject === argumentSymbol && key === sourcePrimitiveFactKey ? { kind: "uint32" } : undefined,
      getFact: () => undefined },
    ast: {
      kind: () => undefined,
      kindName: node => node === declaration ? "KindInterfaceDeclaration" : node === method ? "KindMethodSignature" : undefined,
      is: { IsClassDeclaration: () => false, IsClassExpression: () => false,
        IsTypeParameterDeclaration: () => false,
        IsTypeAliasDeclaration: () => false,
        IsInterfaceDeclaration: node => node === declaration },
    },
  };
  const options = { sourceTypes: { carrierForDeclaration: () => carrier, structuralObjectForType: () => undefined } };
  return { symbol, declaration, selectedType, apparent, argumentType, parameters, carrier, types, declarations, context, options };
}

test("constrained self uses a finite declared carrier without expanding optional member results", () => {
  for (const optional of [false, true]) {
    const fixture = selfReference({ optional });
    const selected = resolveProjectSourceCarrier(fixture.symbol, { values: [] }, fixture.context,
      fixture.options, fixture.declaration, fixture.selectedType);
    assert.equal(rustTargetTypeRefEquals(selected, fixture.carrier), true);
    assert.equal(rustSourceTypeCarrierValue(selected).genericArguments.length, 0);
  }
});

test("constrained self obtains generic arguments from the exact apparent declaration", () => {
  const fixture = selfReference({ generic: true });
  const selected = resolveProjectSourceCarrier(fixture.symbol, { values: [] }, fixture.context,
    fixture.options, fixture.declaration, fixture.selectedType);
  const arguments_ = rustSourceTypeCarrierValue(selected)?.genericArguments;
  assert.equal(arguments_?.length, 1);
  assert.equal(arguments_[0].kind, "type");
  assert.equal(arguments_[0].type.kind, "source-primitive");
  assert.equal(arguments_[0].type.name, "uint32");
  assert.equal(fixture.parameters[0].identity, "/self.ts:Value");
});

test("constrained self rejects missing, recursive and inconsistent generic evidence", () => {
  for (const mutate of [
    fixture => { fixture.types.effectiveTypeArguments = () => undefined; },
    fixture => { fixture.types.effectiveTypeArguments = () => []; },
    fixture => { fixture.parameters[0] = { ...fixture.parameters[0], kind: "lifetime", lifetime: { kind: "static" } }; },
    fixture => { fixture.options.sourceTypes.carrierForDeclaration = () => undefined; },
  ]) {
    const fixture = selfReference({ generic: true });
    mutate(fixture);
    assert.equal(resolveProjectSourceCarrier(fixture.symbol, { values: [] }, fixture.context,
      fixture.options, fixture.declaration, fixture.selectedType) === undefined, true);
  }
  const recursive = selfReference({ generic: true });
  recursive.types.effectiveTypeArguments = () => [recursive.apparent];
  assert.equal(resolveProjectSourceCarrier(recursive.symbol, { values: [] }, recursive.context,
    recursive.options, recursive.declaration, recursive.selectedType, new Set([recursive.apparent])) === undefined, true);
});

test("an unrelated apparent symbol cannot replace the selected declaration or its arguments", () => {
  const fixture = selfReference({ generic: true, optional: false });
  const otherSymbol = Object.freeze({});
  fixture.declarations.typeSymbol = type => type === fixture.apparent ? otherSymbol : fixture.symbol;
  fixture.types.effectiveTypeArguments = () => { throw new Error("Unrelated apparent arguments must not be selected"); };
  const argument = { kind: "type", type: { kind: "source-primitive", name: "int64" } };
  const selected = resolveProjectSourceCarrier(fixture.symbol, { values: [argument] }, fixture.context,
    fixture.options, fixture.declaration, fixture.selectedType);
  assert.equal(rustTargetTypeRefEquals(selected,
    rustSourceTypeCarrier("/self.ts", "Fluent", "object", [argument])), true);
});
