import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { isRustUnionArmMappings, selectRustUnionArmMapping, rustUnionProjectionContract } from "../../../dist/target-model/types/union-relations.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { planRustUnionMapping, planRustUnionProjection } from "../../../dist/backend/planner/expressions/union-mappings.js";
import { selectRustSourceAssertionConversion, selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { validateValueConversion } from "../../../dist/providers/packages/validation/carriers.js";
import { rustJsIntlGroupingTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";
import { visitConversionContract } from "../../../dist/backend/planner/liveness/generated-item-usage-helpers.js";

test("union mappings require complete exact coverage and reject forged or numeric-changing arms", () => {
  const integer = rustSourcePrimitiveTargetType("int64");
  const string = rustStringTargetType();
  const boolean = rustSourcePrimitiveTargetType("bool");
  const narrow = rustSourceUnionTargetType("/src/index.ts", "Narrow");
  const wide = rustSourceUnionTargetType("/src/index.ts", "Wide");
  const wrong = rustSourceUnionTargetType("/src/index.ts", "Wrong");
  const registry = createRustTypeDefinitionRegistry();
  for (const [carrier, payloads] of [[narrow, [string, integer]], [wide, [integer, boolean, string]],
    [wrong, [string, rustSourcePrimitiveTargetType("float64")]]]) {
    assert.equal(registry.registerSourceUnion({ carrier,
      variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })) }, true), true);
  }
  const definitions = registry.seal();
  const widening = selectRustUnionArmMapping(narrow, wide, "source", definitions);
  const narrowing = selectRustUnionArmMapping(wide, narrow, "target", definitions);
  assert.deepEqual(widening.map(arm => [arm.source[0].variant.name, arm.target[0].variant.name]), [["Variant0", "Variant2"], ["Variant1", "Variant0"]]);
  assert.deepEqual(narrowing.map(arm => [arm.source[0].variant.name, arm.target[0].variant.name]), [["Variant0", "Variant1"], ["Variant2", "Variant0"]]);
  assert.equal(selectRustUnionArmMapping(wide, narrow, "source", definitions), undefined);
  assert.equal(selectRustUnionArmMapping(narrow, wide, "target", definitions), undefined);
  assert.equal(selectRustUnionArmMapping(narrow, wrong, "source", definitions), undefined);
  assert.equal(selectRustUnionArmMapping(narrow, wrong, "target", definitions), undefined);
  assert.ok(Object.isFrozen(widening) && widening.every(Object.isFrozen));
  const conversion = { kind: "union-map", source: narrow, target: wide, coverage: "source", arms: widening };
  assert.equal(rustValueConversionContract(conversion, definitions).lowering, "union-map");
  const constructed = [];
  visitConversionContract(rustValueConversionContract(conversion, definitions), () => assert.fail("no field read"),
    (carrier, variant) => constructed.push([carrier, variant]), () => assert.fail("no closed object"));
  assert.deepEqual(constructed, [[wide, "Variant2"], [wide, "Variant0"]]);
  assert.deepEqual(substituteRustValueConversion(conversion, new Map()), conversion);
  const explicit = selectRustSourceAssertionConversion(wide, narrow, definitions);
  assert.equal(explicit.coverage, "target");
  assert.equal(rustValueConversionContract(explicit, definitions).coverage, "target");
  assert.equal(selectRustSourceValueConversion(wide, narrow, definitions), undefined);
  for (const coverage of [undefined, "guessed", "source"]) {
    assert.equal(rustValueConversionContract({ ...explicit, coverage }, definitions), undefined);
  }
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "acme::accept", argConversions: [conversion] },
    sourceArgumentCarriers: [narrow], resultCarrier: boolean, isAsync: false, isFallible: false }, definitions);
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi, definitions), true);
  assert.equal(validateRustFinalizedOperationAbi(abi), false);
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) }, typeDefinitions: definitions,
    names: { nameForSourceType: (_file, name) => name }, configuration: { edition: "2024" } } },
    sourceFile, diagnostics: [], moduleName: "index", moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map() };
  const expression = { kind: "call", path: "next", args: [] };
  for (const source of [wide, rustOptionTargetType(wide)]) {
    for (const target of [string, rustOptionTargetType(string)]) {
      const selected = rustUnionProjectionContract(source, target, definitions);
      const projection = selectRustSourceAssertionConversion(source, target, definitions);
      if (source === wide && target !== string) {
        assert.equal(selected, undefined);
        assert.equal(projection, undefined);
        continue;
      }
      assert.equal(projection.kind, "union-project");
      assert.equal(selected.variant.name, "Variant2");
      assert.equal(rustValueConversionContract(projection, definitions).lowering, "union-project");
      const planned = planRustUnionProjection(node, expression, source, target, "move", context);
      assert.equal(planned.kind, "match");
      assert.equal(planned.expression, expression);
      assert.equal(planned.arms.at(-1).expression.kind, "unreachable");
      assert.equal(planned.arms.length, target === string ? 2 : 3);
      const borrowed = planRustUnionProjection(node, expression, source, target, "shared-reference", context);
      if (target === string) {
        assert.deepEqual(borrowed.expression, { kind: "reference", expr: expression });
        assert.equal(borrowed.arms[0].expression.kind, "path");
        const cloned = planRustUnionProjection(node, expression, source, target, "clone", context);
        assert.equal(cloned.arms[0].expression.method, "clone");
      } else {
        assert.equal(borrowed, undefined);
      }
      assert.deepEqual(substituteRustValueConversion(projection, new Map()), projection);
    }
  }
  for (const target of [rustSourcePrimitiveTargetType("uint64"), rustSourcePrimitiveTargetType("float64")]) {
    assert.equal(rustUnionProjectionContract(wide, target, definitions), undefined);
    assert.equal(rustValueConversionContract({ kind: "union-project", source: wide, target }, definitions), undefined);
  }
  for (const owned of [false, true]) {
    const planned = planRustUnionMapping(node, expression, wide, narrow, narrowing, "target", owned, true, true, context);
    assert.equal(planned.kind, "match");
    assert.deepEqual(planned.expression, owned ? expression : { kind: "reference", expr: expression });
    assert.deepEqual(planned.arms[2], { pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } });
    const stringPayload = planned.arms[1].expression.args[0].args[0];
    assert.equal(stringPayload.kind, owned ? "path" : "method-call");
    if (!owned) assert.equal(stringPayload.method, "clone");
    assert.equal(planned.arms[3].pattern.kind, "wildcard");
  }
  for (const arms of [widening.slice(1), [...widening, widening[0]], widening.toReversed(),
    widening.map((arm, index) => index === 0 ? { ...arm, target: [{ union: wide, variant: { kind: "payload", name: "Missing" } }] } : arm),
    widening.map((arm, index) => index === 0 ? { ...arm, carrier: boolean } : arm)]) {
    assert.equal(rustValueConversionContract({ ...conversion, arms }, definitions), undefined);
    assert.equal(planRustUnionMapping(node, expression, narrow, wide, arms, "source", true, false, false, context), undefined);
    assert.equal(validateRustFinalizedOperationAbi({ ...abi, targetArguments: [{ ...abi.targetArguments[0],
      conversion: { ...abi.targetArguments[0].conversion, conversion: { ...conversion, arms } } }] }, definitions), false);
  }
  assert.equal(planRustUnionMapping(node, expression, wide, narrow, narrowing, "target", true, false, true, context), undefined);
});

test("unit variants preserve their native constant and reject broader payloads or malformed metadata", () => {
  const source = { kind: "target-named", id: rustJsIntlGroupingTargetId };
  const target = rustSourceUnionTargetType("/src/index.ts", "Grouping");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: target, variants: [
    { name: "Boolean", carrier: rustSourcePrimitiveTargetType("bool") },
    { name: "String", carrier: rustStringTargetType() },
  ] }, true), true);
  const definitions = registry.seal();
  const arms = selectRustUnionArmMapping(source, target, "source", definitions);
  assert.ok(isRustUnionArmMappings(arms));
  assert.deepEqual(arms[0].source, [{ union: source, variant: { kind: "constant", name: "Disabled", value: false } }]);
  assert.deepEqual(arms[0].target, [{ union: target, variant: { kind: "payload", name: "Boolean" } }]);
  for (const coverage of ["source", "target"]) {
    assert.equal(selectRustUnionArmMapping(target, source, coverage, definitions), undefined);
  }
  const conversion = { kind: "union-map", source, target: source, coverage: "source",
    arms: selectRustUnionArmMapping(source, source, "source", definitions) };
  const fail = message => { throw new Error(message); };
  assert.doesNotThrow(() => validateValueConversion(conversion, {}, "conversion", source, source, fail));
  for (const invalidArms of [[], new Array(1), [null], [{ ...arms[0], extra: true }],
    [{ ...arms[0], carrier: { kind: "source-primitive", name: "missing" } }],
    [{ ...arms[0], source: [] }], [{ ...arms[0], target: new Array(1) }],
    [{ ...arms[0], source: [{ union: source, variant: { kind: "constant", name: "Disabled", value: 0 } }] }],
    [{ ...arms[0], target: [{ union: target, variant: { kind: "payload", name: "Boolean", value: false } }] }]]) {
    assert.equal(isRustUnionArmMappings(invalidArms), false);
    assert.throws(() => validateValueConversion({ ...conversion, arms: invalidArms }, {}, "conversion", source, source, fail));
  }
  const changed = conversion.arms.map((arm, index) => index === 0
    ? { ...arm, source: arm.source.map(step => ({ ...step, variant: { ...step.variant, value: true } })) } : arm);
  assert.ok(isRustUnionArmMappings(changed));
  assert.equal(rustValueConversionContract({ ...conversion, arms: changed }, definitions), undefined);
  assert.throws(() => validateValueConversion({ ...conversion, arms: changed }, {}, "conversion", source, source, fail));
});

test("nested union paths retain exact coverage, terminal array payloads and all construction owners", () => {
  const integer = rustSourcePrimitiveTargetType("uint64");
  const string = rustStringTargetType();
  const boolean = rustSourcePrimitiveTargetType("bool");
  const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
  const nested = rustSourceUnionTargetType("/src/index.ts", "Nested");
  const flat = rustSourceUnionTargetType("/src/index.ts", "Flat");
  const array = { kind: "array", element: inner };
  const registry = createRustTypeDefinitionRegistry();
  for (const [carrier, payloads] of [[inner, [integer, string, array]], [nested, [boolean, inner]], [flat, [array, string, boolean, integer]]]) {
    assert.equal(registry.registerSourceUnion({ carrier, variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })) }, true), true);
  }
  const definitions = registry.seal();
  const arms = selectRustUnionArmMapping(flat, nested, "source", definitions);
  assert.deepEqual(arms.map(arm => arm.target.map(step => step.variant.name)),
    [["Variant1", "Variant2"], ["Variant1", "Variant1"], ["Variant0"], ["Variant1", "Variant0"]]);
  assert.deepEqual(arms.map(arm => arm.carrier), [array, string, boolean, integer]);
  const conversion = { kind: "union-map", source: flat, target: nested, coverage: "source", arms };
  const constructed = [];
  visitConversionContract(rustValueConversionContract(conversion, definitions), () => assert.fail("no structural read"),
    (carrier, name) => constructed.push([carrier, name]), () => assert.fail("no closed object"));
  assert.deepEqual(constructed.slice(0, 2), [[nested, "Variant1"], [inner, "Variant2"]]);
  for (const target of [arms[0].target.slice(1), arms[0].target.toReversed(),
    arms[0].target.map(step => ({ ...step, union: flat })),
    [arms[0].target[0], arms[0].target[0]]]) {
    assert.equal(rustValueConversionContract({ ...conversion, arms: [{ ...arms[0], target }, ...arms.slice(1)] }, definitions), undefined);
  }
  const cycle = { sourceUnionVariants: () => [{ name: "Loop", carrier: nested }] };
  assert.equal(selectRustUnionArmMapping(nested, flat, "source", cycle), undefined);
});
