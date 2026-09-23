import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceSelectionUsesExactBindings } from "../../../dist/policy/types/resolution/bound-source-selection.js";

function fixture() {
  const parameter = { kind: "parameter", declaration: {} };
  const otherParameter = { kind: "parameter", declaration: {} };
  const scalar = {};
  const wrongScalar = {};
  const alias = {};
  const aliasParameter = {};
  const target = {};
  const reference = argument => ({ kind: "reference", target, arguments: [argument] });
  const application = argument => ({ kind: "alias", application: { declaration: alias,
    bindings: [{ declaration: aliasParameter, argument }] } });
  const union = (...members) => ({ kind: "union", members });
  const context = {
    sourceTypeParameterSubstitutions: new Map([[parameter.declaration, { sourceType: scalar, carrier: {} }]]),
    currentSemantics: {
      declarations: { typeSymbol: type => type.kind === "parameter" ? type : undefined,
        primarySymbolDeclaration: symbol => symbol.declaration },
      types: {
        isIdentical: (left, right) => left === right,
        aliasApplication: type => type.application,
        isTypeReference: type => type.kind === "reference",
        typeReferenceTarget(type) { assert.equal(type.kind, "reference"); return type.target; },
        typeArguments: type => type.arguments,
        isUnion: type => type.kind === "union",
        unionOrIntersectionTypes: type => type.members,
      },
    },
  };
  return { parameter, otherParameter, scalar, wrongScalar, reference, application, union, context };
}

test("bound source components retain exact identities through aliases, references and reordered unions", () => {
  const input = fixture();
  const { parameter, scalar, reference, application, union, context } = input;
  const absent = {};
  assert.equal(rustSourceSelectionUsesExactBindings(parameter, scalar, context), true);
  assert.equal(rustSourceSelectionUsesExactBindings(parameter, parameter, context), true);
  assert.equal(rustSourceSelectionUsesExactBindings(application(reference(union(parameter, absent))),
    application(reference(union(absent, scalar))), context), true);
  assert.equal(rustSourceSelectionUsesExactBindings(reference(scalar), reference(scalar), context), false);
  assert.equal(context.sourceTypeParameterSubstitutions.size, 1);
});

test("bound source components reject foreign declarations, wrong arguments, ambiguity and cycles", () => {
  const { parameter, otherParameter, scalar, wrongScalar, reference, application, union, context } = fixture();
  assert.equal(rustSourceSelectionUsesExactBindings(otherParameter, scalar, context), false);
  assert.equal(rustSourceSelectionUsesExactBindings(parameter, wrongScalar, context), false);
  assert.equal(rustSourceSelectionUsesExactBindings(application(parameter), { ...application(scalar),
    application: { ...application(scalar).application, declaration: {} } }, context), false);
  assert.equal(rustSourceSelectionUsesExactBindings(reference(parameter), { ...reference(scalar), target: {} }, context), false);
  assert.equal(rustSourceSelectionUsesExactBindings(union(parameter, scalar), union(parameter, scalar), context), false);
  const recursive = reference(parameter);
  recursive.arguments = [recursive];
  assert.equal(rustSourceSelectionUsesExactBindings(recursive, recursive, context), false);
  assert.equal(rustSourceSelectionUsesExactBindings(parameter, scalar,
    { ...context, sourceTypeParameterSubstitutions: new Map() }), false);
});
