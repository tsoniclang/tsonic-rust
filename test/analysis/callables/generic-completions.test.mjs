import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRustSourcePackageComponents } from "../../../dist/analysis/program/source-package-components.js";
import { createRustGenericCallableCompletionPlan } from "../../../dist/analysis/callables/generic-completions.js";
import { rustSourceUnionCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture(second) {
  const context = analyzeRustErrorEffects(`
    type Read = <Value>(value: Value) => Promise<Value>;
    export function choose(selected: boolean): Read {
      return selected ? async <Value>(value: Value): Promise<Value> => value
        : async <Value>(value: Value): Promise<Value> => { ${second} };
    }
    export function main(): void { const read = choose(true); read<number>(1); }
  `);
  const components = analyzeRustSourcePackageComponents(context, "lib");
  assert.equal(components.kind, "resolved", components.diagnostics?.map(row => `${row.code}: ${row.message}`).join("\n"));
  const input = { ast: context.ast, sourceLifetimes: context.sourceLifetimes, facts: context.facts,
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
  assert.equal(current.selection.result.genericArguments[2].type.id, "rust.core.Infallible");
  for (const member of current.definition.members) {
    const selected = current.selection.forMember(member);
    assert.equal(selected !== undefined, true);
    assert.equal(selected.variant, undefined);
    assert.equal(rustTargetTypeRefEquals(selected.result, current.selection.result), true);
  }
  assert.equal(current.input.definitions.generatedUnions().length, 0);
});

test("heterogeneous Promise error channels retain the same payloads in one registered physical union", () => {
  const current = fixture('throw new Error("second");');
  assert.equal(current.selection.kind, "selected", current.selection.reason);
  const result = rustSourceUnionCarrierValue(current.selection.result);
  assert.equal(result?.origin, "generated");
  assert.equal(result?.payloads.kind, "physical");
  const variants = current.input.definitions.sourceUnionVariants(current.selection.result);
  assert.equal(variants.length, 2);
  assert.equal(current.input.definitions.generatedUnions().length, 1);
  const errors = new Set();
  for (const member of current.definition.members) {
    const selected = current.selection.forMember(member);
    const variant = variants.find(variant => variant.name === selected.variant);
    assert.equal(rustTargetTypeRefEquals(variant?.carrier, selected.result), true);
    assert.equal(selected.result.id, "rust.js.JsPromise");
    const error = selected.result.genericArguments[2].type;
    errors.add(error.errorOwner?.kind === "physical" ? error.errorOwner.domain : error.id);
  }
  assert.deepEqual([...errors].sort(), ["runtime", "rust.core.Infallible"].sort());
  assert.equal(Object.isFrozen(current.selection.result), true);
});

test("completion invocation substitutes exact quantified arguments without changing its physical union topology", () => {
  const current = fixture('throw new Error("second");');
  const integer = { kind: "source-primitive", name: "int32" };
  const selected = current.plan.invocationResultFor(current.definition.carrier, [{ kind: "type", type: integer }]);
  assert.equal(selected !== undefined, true);
  const variants = current.input.definitions.sourceUnionVariants(selected);
  assert.equal(variants.length, 2);
  assert.equal(variants.every(variant => rustTargetTypeRefEquals(variant.carrier.genericArguments[1].type, integer)), true);
  assert.equal(current.plan.invocationResultFor(current.definition.carrier, []) === undefined, true);
});

test("completion member identity cannot be invented or replaced by the same logical signature", () => {
  const current = fixture('throw new Error("second");');
  assert.equal(current.selection.forMember({ ...current.definition.members[0] }) === undefined, true);
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
