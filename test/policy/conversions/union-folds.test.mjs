import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustJsValueTargetType, rustJsStringNumberTargetType, rustSourcePrimitiveTargetType, rustStringTargetType,
  rustSourceUnionTargetType, rustObjectIdentityTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import { rustValueConversionContract, rustValueConversionIdentity } from "../../../dist/target-model/conversions/contracts.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { selectRustSourceValueConversion, selectRustJsonValueConversion } from "../../../dist/policy/conversions/selection.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { validateValueConversion } from "../../../dist/providers/packages/validation/carriers.js";
import { materializeProviderOperationRow } from "../../../dist/providers/packages/materialization.js";
import { lowerRustValueConversion } from "../../../dist/backend/planner/expressions/value-conversions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("union folds share exact generated/runtime paths and retain native integer leaf conversions", () => {
  const runtime = rustJsStringNumberTargetType();
  const grouping = { kind: "target-named", id: rustJsIntlGroupingTargetId };
  const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
  const outer = rustSourceUnionTargetType("/src/index.ts", "Outer");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: inner, variants: [
    { name: "Wide", carrier: rustSourcePrimitiveTargetType("uint64") },
    { name: "Runtime", carrier: runtime },
  ] }, true), true);
  assert.equal(registry.registerSourceUnion({ carrier: outer, variants: [
    { name: "Nested", carrier: inner }, { name: "Grouping", carrier: grouping },
  ] }, true), true);
  const definitions = registry.seal();
  for (const source of [runtime, grouping, inner, outer]) {
    for (const select of [selectRustSourceValueConversion, (source, _target, definitions) => selectRustJsonValueConversion(source, definitions)]) {
      const conversion = select(source, rustJsValueTargetType(), definitions);
      assert.equal(conversion.kind, "union-fold");
      assert.deepEqual(conversion.arms.map(({ carrier, path }) => ({ carrier, path })), rustUnionLeaves(source, definitions));
      assert.ok(Object.isFrozen(conversion) && Object.isFrozen(conversion.arms) && conversion.arms.every(Object.isFrozen));
      const contract = rustValueConversionContract(conversion, definitions);
      assert.equal(contract.lowering, "union-fold");
      assert.equal(contract.sourceMode, "value");
      assert.ok(contract.arms.every(arm => arm.conversion.sourceMode === "value"));
      const wide = conversion.arms.find(arm => arm.carrier.name === "uint64");
      if (wide !== undefined) assert.deepEqual(wide.conversion, { kind: "semantic-conversion", id: "js-value-from-u64" });
    }
  }
  assert.equal(selectRustSourceValueConversion({ kind: "target-named", id: rustJsNumericTargetId }, rustJsValueTargetType()), undefined);
  const cycle = { sourceUnionVariants: source => source === outer ? [{ name: "Recursive", carrier: outer }] : undefined };
  assert.equal(selectRustSourceValueConversion(outer, rustJsValueTargetType(), cycle), undefined);
  const unknown = { sourceUnionVariants: source => source === outer
    ? [{ name: "Unknown", carrier: rustObjectIdentityTargetType() }] : undefined };
  assert.equal(selectRustSourceValueConversion(outer, rustJsValueTargetType(), unknown), undefined);
});

test("union fold facts reject incomplete, stale, reordered, malformed and superseded evidence", () => {
  const source = rustJsStringNumberTargetType();
  const target = rustJsValueTargetType();
  const conversion = selectRustSourceValueConversion(source, target);
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "acme::accept", argConversions: [conversion] },
    sourceArgumentCarriers: [source], resultCarrier: target, isAsync: false, isFallible: false });
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  const fail = message => { throw new Error(message); };
  assert.doesNotThrow(() => validateValueConversion(conversion, {}, "fold", source, target, fail));
  const changes = [
    { target: rustStringTargetType() }, { arms: [] }, { arms: new Array(2) }, { arms: conversion.arms.slice(1) },
    { arms: conversion.arms.toReversed() }, { arms: [conversion.arms[0], conversion.arms[0]] },
    { arms: [{ ...conversion.arms[0], path: [] }, conversion.arms[1]] },
    { arms: [{ ...conversion.arms[0], carrier: rustSourcePrimitiveTargetType("uint64") }, conversion.arms[1]] },
    { arms: [{ ...conversion.arms[0], conversion: conversion.arms[1].conversion }, conversion.arms[1]] },
    { arms: [{ ...conversion.arms[0], path: [{ union: source, variant: { kind: "payload", name: "Missing" } }] }, conversion.arms[1]] },
    { arms: [{ ...conversion.arms[0], extra: true }, conversion.arms[1]] },
    { arms: [{ ...conversion.arms[0], conversion: undefined }, conversion.arms[1]] },
  ];
  for (const change of changes) {
    const changed = { ...conversion, ...change };
    assert.equal(rustValueConversionContract(changed), undefined);
    assert.throws(() => validateValueConversion(changed, {}, "fold", source, target, fail));
    assert.equal(validateRustFinalizedOperationAbi({ ...abi, targetArguments: [{ ...abi.targetArguments[0],
      conversion: { ...abi.targetArguments[0].conversion, conversion: changed } }] }), false);
  }
  const old = { kind: "js-value-from-source-union", source, variants: conversion.arms.map(arm => ({
    name: arm.path[0].variant.name, carrier: arm.carrier, conversion: arm.conversion,
  })) };
  assert.equal(rustValueConversionContract(old), undefined);
  assert.throws(() => validateValueConversion(old, {}, "fold", source, target, fail));
  const grouping = selectRustSourceValueConversion({ kind: "target-named", id: rustJsIntlGroupingTargetId }, target);
  const changed = { ...grouping, arms: grouping.arms.map((arm, index) => index === 0
    ? { ...arm, path: arm.path.map(step => ({ ...step, variant: { ...step.variant, value: true } })) } : arm) };
  assert.equal(rustValueConversionContract(changed), undefined);
  assert.notEqual(rustValueConversionIdentity(grouping), rustValueConversionIdentity(changed));
});

test("union folds substitute and materialize every path, target and leaf conversion", () => {
  const parameter = { kind: "type-parameter", identity: "T", name: "T" };
  const source = rustSourceUnionTargetType("/src/index.ts", "Wrapper", [{ kind: "type", type: parameter }]);
  const conversion = { kind: "union-fold", source, target: rustTsValueTargetType(), arms: [{ carrier: parameter,
    path: [{ union: source, variant: { kind: "payload", name: "Value" } }],
    conversion: { kind: "ts-value-from-closed-carrier", source: parameter },
  }] };
  const substitution = substituteRustValueConversion(conversion, new Map([["T", rustStringTargetType()]]));
  assert.deepEqual(substitution.source.value.genericArguments[0].type, rustStringTargetType());
  assert.deepEqual(substitution.arms[0].path[0].union, substitution.source);
  assert.deepEqual(substitution.arms[0].carrier, rustStringTargetType());
  assert.deepEqual(substitution.arms[0].conversion.source, rustStringTargetType());
  assert.deepEqual(substitution.target, rustTsValueTargetType());
  assert.deepEqual(substituteRustValueConversion({ ...conversion, target: parameter },
    new Map([["T", rustStringTargetType()]])).target, rustStringTargetType());
  const runtime = selectRustSourceValueConversion(rustJsStringNumberTargetType(), rustJsValueTargetType());
  const owner = { providerPackageId: "acme", providerId: "acme", providerVersion: "1", providerModuleId: "acme", moduleSpecifier: "acme" };
  const row = materializeProviderOperationRow({ target: { form: "call", path: "acme::accept", argConversions: [runtime] },
    resultCarrier: rustJsValueTargetType(), resultConversion: runtime }, new Map(), {}, {}, owner);
  assert.deepEqual(row.target.argConversions, [runtime]);
  assert.deepEqual(row.resultConversion, runtime);
});

test("native fold planning moves one input and emits unit constants without copying payloads", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  for (const source of [rustJsStringNumberTargetType(), { kind: "target-named", id: rustJsIntlGroupingTargetId }]) {
    const conversion = selectRustSourceValueConversion(source, rustJsValueTargetType());
    const contract = rustValueConversionContract(conversion);
    const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) },
      configuration: { edition: "2024" } } }, sourceFile, diagnostics: [], usedAliases: new Set() };
    const expression = { kind: "call", path: "produce", args: [] };
    const planned = lowerRustValueConversion(contract, expression, context, node);
    assert.deepEqual(context.diagnostics, []);
    assert.equal(planned.kind, "match");
    assert.equal(planned.expression, expression);
    assert.equal(planned.arms.length, contract.arms.length);
    assert.doesNotMatch(JSON.stringify(planned), /clone|from_closed|Rc::|Box::/u);
    const unitIndex = contract.arms.findIndex(arm => arm.path.at(-1).variant.kind === "constant");
    if (unitIndex >= 0) {
      assert.equal(planned.arms[unitIndex].pattern.kind, "path");
      assert.deepEqual(planned.arms[unitIndex].expression.args, [{ kind: "bool-literal", value: false }]);
    }
  }
});
