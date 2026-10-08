import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustSelectedTypeArguments } from "../../../dist/policy/types/resolution/generic-arguments.js";
import { bindRustSelectedReceiverContext } from "../../../dist/analysis/operations/provider/member-carriers.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";

function fixture() {
  const type = {};
  const numberType = {};
  const first = {};
  const second = {};
  const parameters = [first, second];
  const arguments_ = [numberType, numberType];
  const bindings = parameters.map(declaration => ({ declaration, argumentType: numberType, scope: "local" }));
  const integer = { kind: "source-primitive", name: "int32" };
  const selected = { kind: "type-parameter", identity: "call-site:Value", name: "Value" };
  const context = {
    currentSemantics: { types: {
      effectiveTypeArguments: () => arguments_,
      typeArgumentBindings: () => bindings,
      isNonPrimitive: () => true,
    } },
    sourceTypeParameterSubstitutions: new Map([
      [first, { sourceType: numberType, carrier: integer }],
      [second, { sourceType: numberType, carrier: selected }],
    ]),
  };
  return { type, numberType, parameters, arguments_, bindings, integer, selected, context };
}

function receiverFixture() {
  const input = fixture();
  const declaration = {};
  const parameters = input.parameters.map(declaration => ({ declaration, kind: "type" }));
  const definition = { declaration, genericParameters: [...parameters].reverse() };
  const contract = { parameters };
  const context = { ...input.context, sourceLifetimes: { contractFor: () => contract },
    currentSemantics: { ...input.context.currentSemantics,
      types: { ...input.context.currentSemantics.types, aliasApplication: () => undefined } } };
  const options = { projectTypes: { definitionForCarrier: () => definition } };
  const arguments_ = [{ kind: "type", type: input.selected }, { kind: "type", type: input.integer }];
  const receiver = rustSourceTypeCarrier("/src/types.ts", "Pair", "object", arguments_);
  return { ...input, context, options, receiver, arguments_, definition, contract };
}

test("selected receiver generic closure binds by exact declaration identity, not physical parameter order", () => {
  const input = receiverFixture();
  const bound = bindRustSelectedReceiverContext(input.type, input.receiver, input.context, input.options);
  assert.equal(bound?.sourceTypeParameterSubstitutions.get(input.parameters[0])?.carrier === input.integer, true);
  assert.equal(bound?.sourceTypeParameterSubstitutions.get(input.parameters[1])?.carrier === input.selected, true);
  assert.equal(bound?.sourceTypeParameterSubstitutions === input.context.sourceTypeParameterSubstitutions, false);
});

test("selected receiver generic closure rejects missing, duplicate, foreign and incompatible bindings", () => {
  for (const mutate of [
    input => { input.type = undefined; },
    input => { input.receiver = undefined; },
    input => { input.arguments_.pop(); },
    input => { input.definition.genericParameters[1] = input.definition.genericParameters[0]; },
    input => { input.contract.parameters[0] = { declaration: {}, kind: "type" }; },
    input => { input.arguments_[0] = { kind: "lifetime", lifetime: { kind: "static" } }; },
    input => { input.bindings[0].argumentType = {}; input.bindings.push({ ...input.bindings[0] }); },
  ]) {
    const input = receiverFixture();
    mutate(input);
    assert.equal(bindRustSelectedReceiverContext(input.type, input.receiver, input.context, input.options) === undefined, true);
  }
});

test("selected receiver binds exact captured outer generics without manufacturing a local generic contract", () => {
  const input = receiverFixture();
  input.context.sourceLifetimes.contractFor = () => undefined;
  input.bindings.forEach(binding => { binding.scope = "outer"; });
  const bound = bindRustSelectedReceiverContext(input.type, input.receiver, input.context, input.options);
  assert.equal(bound?.sourceTypeParameterSubstitutions.get(input.parameters[0])?.carrier === input.integer, true);
  assert.equal(bound?.sourceTypeParameterSubstitutions.get(input.parameters[1])?.carrier === input.selected, true);
  input.bindings[0].declaration = {};
  assert.equal(bindRustSelectedReceiverContext(input.type, input.receiver, input.context, input.options) === undefined, true);
});

test("semantic generic arguments retain exact ordinal native bindings despite checker-erased equal types", () => {
  const input = fixture();
  const result = resolveRustSelectedTypeArguments(input.type, input.context, {}, new Set());
  assert.equal(result?.[0] === input.integer, true, "explicit native int32 stays int32");
  assert.equal(result?.[1] === input.selected, true, "inferred call-site binder remains its exact identity");
  assert.equal(Object.isFrozen(result), true);
  input.context.sourceTypeParameterSubstitutions.delete(input.parameters[1]);
  const independent = resolveRustSelectedTypeArguments(input.type, input.context, { jsEnabled: false }, new Set());
  assert.equal(independent?.[0] === input.integer, true);
  assert.deepEqual(independent?.[1], { kind: "target-named", id: "rust.runtime.TsValue" });
});

test("semantic generic arguments reject malformed correspondence and never borrow another declaration's binding", () => {
  for (const mutate of [
    input => input.bindings.pop(),
    input => { input.bindings[1].declaration = input.parameters[0]; },
    input => { input.bindings[1].argumentType = {}; },
    input => { input.bindings[1].scope = "outer"; },
    input => { input.context.currentSemantics.types.effectiveTypeArguments = () => undefined; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(resolveRustSelectedTypeArguments(input.type, input.context, {}, new Set()) === undefined, true,
      "complete exact local correspondence is mandatory");
  }
  const input = fixture();
  input.bindings[1].declaration = {};
  const result = resolveRustSelectedTypeArguments(input.type, input.context, { jsEnabled: false }, new Set());
  assert.equal(result?.[0] === input.integer, true);
  assert.deepEqual(result?.[1], { kind: "target-named", id: "rust.runtime.TsValue" });
  input.context.sourceTypeParameterSubstitutions.set(input.parameters[0], { sourceType: {}, carrier: input.integer });
  const unmatched = resolveRustSelectedTypeArguments(input.type, input.context, { jsEnabled: false }, new Set());
  assert.deepEqual(unmatched?.[0], { kind: "target-named", id: "rust.runtime.TsValue" });
});
