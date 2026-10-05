import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustSelectedSourceCallResult } from "../../../dist/policy/types/resolution/call-results.js";
import { rustGenericCallableProtocol, rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { resolveRustUnionValueCarrier } from "../../../dist/policy/types/resolution/source-unions.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";

const parameter = (identity, name = "Item") => ({ kind: "type-parameter", identity, name });
const outer = parameter("outer:Item");
const inner = parameter("inner:Item");
const integer = { kind: "source-primitive", name: "int64" };
const string = rustStringTargetType();
const origin = { fileName: "/factory.ts", declarationIdentity: "inner-factory" };
const options = { sourceTypes: { typeFamilies: { implementation: () => undefined } } };

function input(result = outer) {
  const declaration = {};
  const sourceParameter = {};
  const selectedType = {};
  const symbol = {};
  const context = {
    ast: { is: { IsTypeParameterDeclaration: selected => selected === declaration } },
    currentSemantics: { declarations: {
      typeSymbol: type => type === sourceParameter ? symbol : undefined,
      primarySymbolDeclaration: selected => selected === symbol ? declaration : undefined,
    } },
    sourceTypeParameterSubstitutions: new Map(),
  };
  const selected = {
    member: {
      returnType: result,
      genericParameters: [{ kind: "type", targetIdentity: outer.identity, sourceName: outer.name }],
    },
    targetGenericArguments: [{ kind: "type", type: integer }],
    sourceSelectedMethodTypeArguments: [{ typeParameter: sourceParameter, selectedType }],
  };
  return { selected, context, declaration, sourceParameter, selectedType };
}

test("early result queries instantiate exact native binders instead of returning an open template", () => {
  const fixture = input();
  assert.deepEqual(resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options), integer);
  fixture.selected.targetGenericArguments = [{ kind: "type", type: string }];
  assert.deepEqual(resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options), string);
  assert.equal(fixture.context.sourceTypeParameterSubstitutions.size, 0);
  assert.equal(fixture.selected.member.returnType, outer);
});

test("nested result queries close only the outer environment and retain the inner quantified binder", () => {
  const returned = rustGenericCallableTargetType([inner], [inner], inner, origin, [outer]);
  const fixture = input(returned);
  const result = resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options);
  assert.equal(result !== undefined, true, "nested callable result has an exact closed outer environment");
  assert.deepEqual(rustGenericCallableValue(result).environment, [integer]);
  assert.deepEqual(rustGenericCallableProtocol(result, [string]), { parameters: [string], result: string });
  assert.deepEqual(rustGenericCallableValue(returned).environment, [outer]);
  assert.deepEqual(rustGenericCallableValue(result).origin, origin);
});

test("selected result queries reject missing, mismatched and foreign binding evidence", () => {
  for (const mutate of [
    fixture => { fixture.selected.targetGenericArguments = []; },
    fixture => { fixture.selected.sourceSelectedMethodTypeArguments = []; },
    fixture => { fixture.selected.targetGenericArguments = [{ kind: "lifetime", lifetime: { kind: "static" } }]; },
    fixture => { fixture.context.currentSemantics.declarations.primarySymbolDeclaration = () => ({}); },
    fixture => { fixture.context.currentSemantics.declarations.typeSymbol = () => undefined; },
    fixture => { fixture.selected.member.returnType = undefined; },
  ]) {
    const fixture = input();
    mutate(fixture);
    assert.equal(resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options) === undefined, true);
    assert.equal(fixture.context.sourceTypeParameterSubstitutions.size, 0);
  }
});

test("closed provider results do not rebind already consumed source method arguments", () => {
  const fixture = input(integer);
  fixture.selected.member.genericParameters = [];
  fixture.selected.targetGenericArguments = [];
  fixture.context.currentSemantics.declarations.typeSymbol = () => assert.fail("closed native provider result needs no source rebinding");
  assert.equal(resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options) === integer, true);
});

test("selected result projections require their exact substituted native source", () => {
  const optional = rustSourceOptionalTargetType(outer);
  const fixture = input(optional);
  fixture.selected.sourceResultProjection = { kind: "option-value", sourceCarrier: optional, selectedCarrier: outer };
  assert.deepEqual(resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options), integer);
  fixture.selected.sourceResultProjection = { kind: "closed-native", sourceCarrier: string, selectedCarrier: integer };
  assert.equal(resolveRustSelectedSourceCallResult(fixture.selected, fixture.context, options) === undefined, true,
    "a foreign native projection source cannot supply the result carrier");
});

test("conditional quantified creation retains one exact protocol without erasing declaration origins", () => {
  const first = rustGenericCallableTargetType([outer], [outer, outer], outer, origin);
  const second = rustGenericCallableTargetType([inner], [inner, inner], inner, {
    ...origin, declarationIdentity: "second-creation",
  });
  const selected = resolveRustUnionValueCarrier([first, second], {}, () => assert.fail("identical protocols must not become a union"));
  assert.equal(selected === first, true, "selected conditional protocol is reused");
  assert.equal(rustTargetTypeRefEquals(first, second), false, "exact origins remain distinct native creation identities");
  assert.deepEqual(rustGenericCallableProtocol(selected, [integer]), { parameters: [integer, integer], result: integer });
});

test("quantified conditional carriers retain exact signature and environment rejection", () => {
  const first = rustGenericCallableTargetType([outer], [outer, outer], outer, origin, [integer]);
  for (const incompatible of [
    rustGenericCallableTargetType([inner], [inner], inner, origin),
    rustGenericCallableTargetType([inner], [inner, inner], string, origin),
    rustGenericCallableTargetType([inner], [inner, inner], inner, origin, [parameter("captured:Value")]),
    integer,
  ]) {
    let inferred = 0;
    const union = { kind: "opaque", id: "checked-union" };
    const selected = resolveRustUnionValueCarrier([first, incompatible], {
      resolveProjectUnionCarrier: () => undefined,
    }, () => { inferred++; return union; });
    assert.equal(selected === union, true);
    assert.equal(inferred, 1);
  }
});
