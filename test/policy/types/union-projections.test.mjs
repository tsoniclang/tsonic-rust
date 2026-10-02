import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { rustUnionInjectionPath, rustUnionInjectionVariant, rustUnionProjectionContract } from "../../../dist/target-model/types/union-relations.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { planRustUnionProjection } from "../../../dist/backend/planner/expressions/union-mappings.js";
import { planRustUnionConstruction } from "../../../dist/backend/planner/expressions/union-patterns.js";
import { visitConversionContract } from "../../../dist/backend/planner/liveness/generated-item-usage-helpers.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("nested union payload paths are exact, immutable and independently checked", () => {
  const integer = rustSourcePrimitiveTargetType("uint64");
  const string = rustStringTargetType();
  const boolean = rustSourcePrimitiveTargetType("bool");
  const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
  const nested = rustSourceUnionTargetType("/src/index.ts", "Nested");
  const duplicate = rustSourceUnionTargetType("/src/index.ts", "Duplicate");
  const registry = createRustTypeDefinitionRegistry();
  for (const [carrier, arms] of [[inner, [integer, string]], [nested, [boolean, inner]], [duplicate, [integer, inner]]]) {
    assert.equal(registry.registerSourceUnion({ carrier, variants: arms.map((carrier, index) => ({ name: `Variant${index}`, carrier })) }, true), true);
  }
  const definitions = registry.seal();
  const selected = rustUnionProjectionContract(nested, integer, definitions);
  assert.deepEqual(selected.path, [
    { union: nested, variant: { kind: "payload", name: "Variant1" } },
    { union: inner, variant: { kind: "payload", name: "Variant0" } },
  ]);
  assert.ok(Object.isFrozen(selected.path) && selected.path.every(Object.isFrozen));
  assert.deepEqual(rustUnionInjectionPath(integer, nested, definitions), selected.path);
  assert.deepEqual(rustUnionInjectionVariant(integer, nested, definitions), { kind: "payload", name: "Variant1" });
  const conversion = { kind: "source-union-variant", source: integer, target: nested, variantName: "Variant1" };
  const contract = rustValueConversionContract(conversion, definitions);
  assert.deepEqual(contract.path, selected.path);
  assert.ok(Object.isFrozen(contract.path) && contract.path.every(Object.isFrozen));
  for (const invalid of [
    { ...conversion, source: rustSourcePrimitiveTargetType("int64") },
    { ...conversion, target: duplicate },
    { ...conversion, variantName: "Variant0" },
    { ...conversion, variantName: "missing" },
    { ...conversion, path: selected.path },
  ]) assert.equal(rustValueConversionContract(invalid, definitions), undefined);
  const constructed = [];
  visitConversionContract(contract, () => assert.fail("Union injection must not read structural storage"),
    (carrier, variant) => constructed.push([carrier, variant]), () => assert.fail("no closed object"));
  assert.deepEqual(constructed, [[nested, "Variant1"], [inner, "Variant0"]]);
  const node = fakeStatement({ kindName: "KindIdentifier" });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", statements: [node] });
  const context = { input: { program: { typeDefinitions: definitions, facts: { getFact: () => undefined },
    names: { nameForSourceType: (_file, name) => name }, configuration: { edition: "2024" },
    source: { ast: fakeAstReader([sourceFile]) } } }, moduleName: "index", moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(), diagnostics: [] };
  const expression = { kind: "path", path: "value" };
  assert.deepEqual(planRustUnionConstruction(contract.path, expression, context), {
    kind: "call", path: "Nested::Variant1", args: [{ kind: "call", path: "Inner::Variant0", args: [expression] }],
  });
  const planned = planRustUnionProjection(node, expression, nested, integer, "shared-reference", context);
  assert.deepEqual(planned.expression, { kind: "reference", expr: expression });
  assert.equal(planned.arms[0].pattern.elements[0].path, "Inner::Variant0");
  assert.equal(planned.arms[0].expression.kind, "path");
  assert.equal(planned.arms.at(-1).expression.kind, "unreachable");
  assert.equal(rustUnionProjectionContract(nested, rustSourcePrimitiveTargetType("int64"), definitions), undefined);
  assert.equal(rustUnionProjectionContract(nested, rustOptionTargetType(integer), definitions), undefined);
  assert.equal(rustUnionProjectionContract(duplicate, integer, definitions), undefined);
  assert.equal(rustUnionInjectionPath(integer, duplicate, definitions), undefined);
  assert.equal(rustUnionInjectionPath(rustOptionTargetType(integer), nested, definitions), undefined);
  const cycle = { sourceUnionVariants: () => [{ name: "Loop", carrier: nested }] };
  assert.equal(rustUnionProjectionContract(nested, integer, cycle), undefined);
  assert.equal(rustUnionInjectionPath(integer, nested, cycle), undefined);
});
