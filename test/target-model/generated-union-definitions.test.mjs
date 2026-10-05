import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType,
  rustJsPromiseTargetTypeWithLifetime } from "../../dist/target-model/types/index.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../dist/target-model/types/await.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { createRustGeneratedUnionPlan } from "../../dist/analysis/objects/generated-union-plan.js";

const error = { kind: "target-named", id: "rust.program.TsonicError" };
const text = rustStringTargetType();
const integer = rustSourcePrimitiveTargetType("int64");
const union = (members, fileName = "/src/index.ts", origin = "generated") => rustSourceUnionTargetType(
  fileName, "Union2", members.map(type => ({ kind: "type", type })), origin);
const definition = carrier => ({ carrier,
  variants: carrier.value.genericArguments.map((argument, index) => ({ name: `Variant${index}`, carrier: argument.type })) });

test("generated native union definitions retain generic payload applications after promise lifetime closure", () => {
  const registry = createRustTypeDefinitionRegistry();
  const pending = [text, integer].map(output => rustJsPromiseTargetTypeWithLifetime(output, { kind: "placeholder" }, error));
  const original = union(pending);
  const record = { ...definition(original), sourceType: {}, selectedProperties: [],
    variants: definition(original).variants.map(variant => ({ ...variant, sourceTypes: [{}] })) };
  const plan = createRustGeneratedUnionPlan([record], () => "root", new Map());
  assert.equal(registry.registerSourceUnion(definition(original), false), true);
  const closed = union([text, integer].map(output => rustJsPromiseTargetTypeWithLifetime(output, { kind: "static" }, error)));
  assert.equal(plan.unionForCarrier(closed), plan.unionForCarrier(original));
  const selected = registry.sourceUnionVariants(closed);
  assert.equal(selected?.length, 2);
  selected.forEach((variant, index) => {
    assert.equal(variant.name, `Variant${index}`);
    assert.equal(rustTargetTypeRefEquals(variant.carrier, closed.value.genericArguments[index].type), true);
    assert.equal(Object.isFrozen(variant), true);
  });
  const awaited = rustAwaitSelection(closed, registry);
  assert.equal(awaited?.kind, "union");
  assert.equal(rustAwaitSelectionLeaves(awaited).length, 2);
  assert.equal(registry.registerSourceUnion(definition(closed), false), true);
  assert.equal(registry.registerSourceUnion(definition(closed), true), true);
  const sealed = registry.seal();
  const reordered = union([integer, text]);
  assert.equal(plan.unionForCarrier(reordered), plan.unionForCarrier(original));
  assert.equal(plan.unionForCarrier(union([text])), undefined);
  assert.equal(plan.unionForCarrier(union([text, integer], "/src/other.ts")), undefined);
  assert.equal(rustTargetTypeRefEquals(sealed.sourceUnionVariants(reordered)?.[0].carrier, integer), true);
  assert.throws(() => registry.registerSourceUnion(definition(closed), false), /sealed/u);
});

test("generated native union schemas remain registered, identity-bound and exact-arity", () => {
  const registry = createRustTypeDefinitionRegistry();
  const original = union([text, integer]);
  assert.equal(registry.sourceUnionVariants(original), undefined);
  assert.equal(registry.registerSourceUnion(definition(original), false), true);
  for (const malformed of [union([text]), union([text, integer, text]),
    union([text, integer], "/src/other.ts"), union([text, integer], "/src/index.ts", "authored"),
    { ...original, value: { ...original.value, genericArguments: [{ kind: "const", value: "1" }, { kind: "type", type: integer }] } }]) {
    assert.equal(registry.sourceUnionVariants(malformed), undefined);
  }
  const contradictory = { carrier: original, variants: [
    { name: "Variant0", carrier: integer }, { name: "Variant1", carrier: text },
  ] };
  assert.equal(registry.registerSourceUnion(contradictory, false), false);
  assert.equal(registry.registerSourceUnion({ carrier: original,
    variants: [{ name: "Other", carrier: text }, { name: "Variant1", carrier: integer }] }, false), false);
  assert.equal(rustTargetTypeRefEquals(registry.sourceUnionVariants(original)?.[0].carrier, text), true);
});
