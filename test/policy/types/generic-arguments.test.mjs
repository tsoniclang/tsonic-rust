import assert from "node:assert/strict";
import test from "node:test";
import { bindRustCallableTypeParameters, bindRustSourceAliasArguments, bindRustSourceDeclarationArguments } from "../../../dist/policy/types/resolution/generic-arguments.js";

function fixture() {
  const declaration = {};
  const parameter = {};
  const sourceType = {};
  const carrier = { kind: "source-primitive", name: "int64" };
  const type = {};
  const authoredTypeNode = {};
  const typeName = {};
  const selectedDeclaration = {};
  const application = { declaration, bindings: [{ declaration: parameter, argument: sourceType }] };
  const context = {
    ast: {
      is: { IsTypeReferenceNode: node => node === authoredTypeNode },
      as: { AsTypeReferenceNode: node => node === authoredTypeNode ? { TypeName: typeName } : undefined },
      typeParameters: owner => owner === declaration ? [parameter] : [],
      typeArguments() { throw new Error("Arguments belong to another declaration"); },
      parent: node => node === parameter ? declaration : undefined,
    },
    currentSemantics: { types: { aliasApplication: selected => selected === type ? application : undefined } },
    semanticsFor: () => ({ types: { authoredType: () => type } }),
    source: { navigation: { sourceReferenceFor: node => node === typeName ? { declaration: selectedDeclaration } : undefined } },
    sourceLifetimes: { contractFor: owner => owner === declaration
      ? { parameters: [{ kind: "type", declaration: parameter }] } : undefined },
    sourceTypeParameterSubstitutions: new Map([[parameter, { sourceType, carrier }]]),
  };
  return { declaration, parameter, sourceType, carrier, type, authoredTypeNode, application, context };
}

function callableFixture() {
  const declaration = {};
  const outerDeclaration = {};
  const innerDeclaration = {};
  const innerType = {};
  const innerSymbol = {};
  const outerType = {};
  const outerCarrier = { kind: "source-primitive", name: "int64" };
  const native = { kind: "type-parameter", identity: "generic-callable:Call:0", name: "CallType0" };
  const parameters = [{ kind: "type", declaration: innerDeclaration, sourceName: "Item" }];
  const semantics = { declarations: {
    declaredType: selected => selected === innerDeclaration ? innerType : undefined,
    typeSymbol: selected => selected === innerType ? innerSymbol : undefined,
    primarySymbolDeclaration: selected => selected === innerSymbol ? innerDeclaration : undefined,
  } };
  const context = {
    sourceLifetimes: { contractFor: selected => selected === declaration ? { parameters } : undefined },
    semanticsFor: selected => {
      assert.equal(selected === declaration || selected === innerDeclaration, true,
        "only the selected callable and its exact checked parameter own binder queries");
      return semantics;
    },
    sourceTypeParameterSubstitutions: new Map([[outerDeclaration, { sourceType: outerType, carrier: outerCarrier }]]),
  };
  return { declaration, outerDeclaration, innerDeclaration, innerType, outerType,
    outerCarrier, native, parameters, semantics, context };
}

test("normalized callable binders retain the exact source owner and outer environment", () => {
  const input = callableFixture();
  const selected = bindRustCallableTypeParameters(input.declaration, [input.native], input.context);
  assert.equal(selected !== undefined, true, "exact normalized binder is retained");
  assert.deepEqual(selected.sourceTypeParameterSubstitutions.get(input.innerDeclaration), {
    sourceType: input.innerType, carrier: input.native,
  });
  assert.deepEqual(selected.sourceTypeParameterSubstitutions.get(input.outerDeclaration), {
    sourceType: input.outerType, carrier: input.outerCarrier,
  });
  assert.equal(selected.currentSemantics === input.semantics, true, "binder queries use their declaration's semantics");
  assert.equal(input.context.sourceTypeParameterSubstitutions.size, 1);
});

test("normalized callable binders reject missing, duplicated, foreign and lifetime owners", () => {
  for (const mutate of [
    input => { input.semantics.declarations.declaredType = () => undefined; },
    input => { input.semantics.declarations.primarySymbolDeclaration = () => ({}); },
    input => { input.parameters[0].kind = "lifetime"; },
  ]) {
    const input = callableFixture();
    mutate(input);
    assert.equal(bindRustCallableTypeParameters(input.declaration, [input.native], input.context) === undefined, true);
    assert.equal(input.context.sourceTypeParameterSubstitutions.size, 1);
  }
  const input = callableFixture();
  assert.equal(bindRustCallableTypeParameters(input.declaration, [], input.context) === undefined, true);
  input.parameters.push(input.parameters[0]);
  assert.equal(bindRustCallableTypeParameters(input.declaration, [input.native, input.native], input.context) === undefined, true);
  assert.equal(bindRustCallableTypeParameters(input.declaration, [input.native,
    { ...input.native, identity: "other-call-binder" }], input.context) === undefined, true);
});

test("alias binding does not borrow argument syntax from a different selected declaration", () => {
  const { parameter, sourceType, carrier, type, authoredTypeNode, context } = fixture();
  const selected = bindRustSourceAliasArguments(type, context, {}, new Set(), authoredTypeNode);
  assert.notEqual(selected, undefined);
  assert.deepEqual(selected.sourceTypeParameterSubstitutions.get(parameter), { sourceType, carrier });
  assert.notEqual(selected.sourceTypeParameterSubstitutions, context.sourceTypeParameterSubstitutions);
  assert.equal(context.sourceTypeParameterSubstitutions.size, 1);
});

test("alias binding rejects conflicting authored and selected alias owners", () => {
  const { type, authoredTypeNode, application, context } = fixture();
  const authoredType = {};
  context.semanticsFor = () => ({ types: { authoredType: () => authoredType } });
  context.currentSemantics.types.aliasApplication = selected => selected === type ? application
    : selected === authoredType ? { ...application, declaration: {} } : undefined;
  assert.equal(bindRustSourceAliasArguments(type, context, {}, new Set(), authoredTypeNode), undefined);
});

test("named source application retains exact native arguments through checked parameter identities", () => {
  const { declaration, parameter, sourceType, carrier, type, context } = fixture();
  context.currentSemantics.types.typeArgumentBindings = () => [{ declaration: parameter, argumentType: sourceType }];
  const selected = bindRustSourceDeclarationArguments(declaration, type, [{ kind: "type", type: carrier }], context);
  assert.deepEqual(selected?.sourceTypeParameterSubstitutions.get(parameter), { sourceType, carrier });
  assert.notEqual(selected?.sourceTypeParameterSubstitutions, context.sourceTypeParameterSubstitutions);
  assert.equal(context.sourceTypeParameterSubstitutions.size, 1);
});

test("named source application rejects missing, duplicate, foreign, inconsistent and wrong-kind bindings", () => {
  const { declaration, parameter, sourceType, carrier, type, context } = fixture();
  const argument = { kind: "type", type: carrier };
  context.currentSemantics.types.aliasApplication = () => undefined;
  for (const bindings of [undefined, [], [{ declaration: {}, argumentType: sourceType }],
    [{ declaration: parameter, argumentType: sourceType }, { declaration: parameter, argumentType: {} }]]) {
    context.currentSemantics.types.typeArgumentBindings = () => bindings;
    assert.equal(bindRustSourceDeclarationArguments(declaration, type, [argument], context), undefined);
  }
  context.currentSemantics.types.typeArgumentBindings = () => [{ declaration: parameter, argumentType: sourceType }];
  assert.equal(bindRustSourceDeclarationArguments(declaration, type, [], context), undefined);
  assert.equal(bindRustSourceDeclarationArguments(declaration, type, [argument, argument], context), undefined);
  assert.equal(bindRustSourceDeclarationArguments(declaration, type, [{ kind: "lifetime", lifetime: { kind: "static" } }], context), undefined);
  context.currentSemantics.types.aliasApplication = () => ({ declaration, bindings: [{ declaration: parameter, argument: {} }] });
  assert.equal(bindRustSourceDeclarationArguments(declaration, type, [argument], context), undefined);
});
