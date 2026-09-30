import assert from "node:assert/strict";
import test from "node:test";
import { bindRustSourceAliasArguments } from "../../../dist/policy/types/resolution/generic-arguments.js";

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
