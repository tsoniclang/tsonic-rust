import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRustSourcePackageComponents } from "../../../dist/analysis/source-modules/component-semantics.js";
import { createRustGenericCallableCompletionPlan } from "../../../dist/analysis/callables/generics/generic-completions.js";
import { rustJsPromiseOutputTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustGenericCallableMemberInvocationBindings } from "../../../dist/analysis/callables/generics/generic-bindings.js";

function fixture(second) {
  const context = analyzeRustErrorEffects(`
    type Read = <Value>(value: Value) => Promise<Value>;
    export function choose(selected: boolean): Read {
      return selected ? async <Value>(value: Value): Promise<Value> => value
        : async <Value>(value: Value): Promise<Value> => { ${second} };
    }
    export function main(): void { const read = choose(true); read<number>(1); }
  `);
  const components = analyzeRustSourcePackageComponents(context, "lib", subject => context.records.errorEffects.get(subject));
  assert.equal(components.kind, "resolved", components.diagnostics?.map(row => `${row.code}: ${row.message}`).join("\n"));
  const input = { ast: context.ast, sourceLifetimes: context.sourceLifetimes, records: context.records,
    physical: context.callableValues.generic.physical, producers: context.callableValues.nativeProducers,
    definitions: context.typeDefinitions, components: components.plan };
  const plan = createRustGenericCallableCompletionPlan(input);
  const definition = input.physical.definitions().find(definition => definition.members.length === 2);
  assert.equal(definition !== undefined, true, "one exact two-member physical family");
  return { context, input, plan, definition, selection: plan.forDefinition(definition) };
}

test("equal producer-owned Promise completions preserve the existing promise carrier without an enum", () => {
  const current = fixture("return value;");
  assert.equal(current.selection.kind, "selected", current.selection.reason);
  assert.equal(current.selection.result.id, "rust.js.JsPromise");
  assert.equal(current.selection.result.genericArguments.length, 1,
    "F1/C01: a shared JS Promise carries its payload only, never a producer-specific rejection generic");
  assert.equal(rustJsPromiseOutputTargetType(current.selection.result) !== undefined, true,
    "the exact generic payload remains selected");
  for (const member of current.definition.members) {
    const selected = current.selection.members.get(member);
    assert.equal(selected !== undefined, true);
    assert.equal(selected.variant, undefined);
    assert.equal(rustTargetTypeRefEquals(selected.result, current.selection.result), true);
  }
  assert.equal(current.input.definitions.generatedUnions().length, 0);
});

test("heterogeneous source errors retain one canonical shared JS Promise without an error-only physical union", () => {
  const current = fixture('throw new Error("second");');
  assert.equal(current.selection.kind, "selected", current.selection.reason);
  assert.equal(current.selection.result.id, "rust.js.JsPromise");
  assert.equal(current.selection.result.genericArguments.length, 1,
    "F1/C01: different source errors cannot reintroduce per-producer JS rejection types");
  assert.equal(current.input.definitions.generatedUnions().length, 0,
    "an error-only distinction does not allocate a physical Promise sum");
  for (const member of current.definition.members) {
    const selected = current.selection.members.get(member);
    assert.equal(selected !== undefined, true, "every exact producer remains admitted");
    assert.equal(selected.variant, undefined, "no obsolete error-only variant is selected");
    assert.equal(rustTargetTypeRefEquals(current.selection.result, selected.result), true);
    assert.equal(selected.result.id, "rust.js.JsPromise");
    assert.equal(rustTargetTypeRefEquals(rustJsPromiseOutputTargetType(selected.result),
      rustJsPromiseOutputTargetType(current.selection.result)), true, "every producer preserves the exact common payload");
  }
  assert.equal(Object.isFrozen(current.selection.result), true);
});

test("completion invocation substitutes exact quantified payload arguments without adding a JS rejection union", () => {
  const current = fixture('throw new Error("second");');
  const integer = { kind: "source-primitive", name: "int32" };
  const selected = current.plan.invocationResultFor(current.definition.carrier, [{ kind: "type", type: integer }]);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.id, "rust.js.JsPromise");
  assert.equal(selected.genericArguments.length, 1, "F1/C01 retains one shared rejection ABI");
  assert.equal(rustTargetTypeRefEquals(rustJsPromiseOutputTargetType(selected), integer), true,
    "the actual quantified native payload, not a widened or unbound alternative");
  assert.equal(current.input.definitions.generatedUnions().length, 0);
  assert.equal(current.plan.invocationResultFor(current.definition.carrier, []) === undefined, true);
});

test("generic invocation correspondence binds actual authored parameters rather than alias parameter names", () => {
  const current = fixture("return value;");
  const integer = { kind: "source-primitive", name: "int64" };
  const arguments_ = [{ kind: "type", type: integer }];
  for (const member of current.definition.members) {
    const contract = current.context.sourceLifetimes.contractFor(member.implementation.declaration);
    const bindings = rustGenericCallableMemberInvocationBindings(current.definition, member,
      current.definition.carrier, arguments_, current.input);
    assert.equal(bindings !== undefined, true, "exact physical member and invocation");
    assert.equal(rustTargetTypeRefEquals(bindings.types.get(contract.parameters[0].identity), integer), true);
    assert.equal(rustGenericCallableMemberInvocationBindings(current.definition, { ...member },
      current.definition.carrier, arguments_, current.input) === undefined, true, "copied member rejected");
    assert.equal(rustGenericCallableMemberInvocationBindings(current.definition, member,
      current.definition.carrier, [], current.input) === undefined, true, "missing quantified argument rejected");
  }
});

test("completion member identity cannot be invented or replaced by the same logical signature", () => {
  const current = fixture('throw new Error("second");');
  assert.equal(current.selection.members.get({ ...current.definition.members[0] }) === undefined, true);
  assert.equal(current.plan.forDefinition({ ...current.definition }).kind, "unresolved");
});

test("missing exact producer completion never substitutes ambient errors or guessed purity", () => {
  const current = fixture("return value;");
  const plan = createRustGenericCallableCompletionPlan({ ...current.input,
    producers: { ...current.input.producers, invocationResultFor: () => undefined } });
  assert.equal(plan.forDefinition(current.definition).kind, "unresolved");
  assert.equal(plan.invocationResultFor(current.definition.carrier,
    [{ kind: "type", type: { kind: "source-primitive", name: "int32" } }]) === undefined, true);
});
