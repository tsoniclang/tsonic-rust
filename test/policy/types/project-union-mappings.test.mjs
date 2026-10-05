import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier, rustSourceUnionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType,
  rustOptionTargetType, rustJsPromiseTargetTypeWithLifetime } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { composeRustUnionArmMappings, selectRustUnionArmMapping } from "../../../dist/target-model/types/union-relations.js";
import { selectRustProjectUnionMapConversion, isRustProjectUnionMapConversion, rustProjectUnionMapConversionMatches } from "../../../dist/target-model/conversions/project-union.js";
import { rustCompilerOwnedContextualConversionMatches, rustContextualRuntimeConversionContract,
  rustContextualValueConversionIsFallible } from "../../../dist/target-model/conversions/contextual.js";
import { selectRustProjectUnionMapping } from "../../../dist/policy/types/project-union-mappings.js";
import { rustProjectUnionUpcastRelation } from "../../../dist/target-model/conversions/project-union-relations.js";
import { selectRustFlowReadProjection, selectRustValueCarrierReconciliation } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustProjectUnionMapping } from "../../../dist/backend/planner/expressions/project-union-mappings.js";
import { planExpression, planRustProjectUpcast } from "../../../dist/backend/planner/expressions/entry.js";
import { applyRustCallableValueAdapterRaw } from "../../../dist/backend/planner/declarations/callables/adapters.js";
import { analyzeRustGeneratedItemUsage } from "../../../dist/backend/planner/liveness/generated-item-usage.js";
import { rustContextualValueConversionFactKey, rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

function fixture({ siblings = false, nested = false, retainDerived = false, relationKind = "related" } = {}) {
  const fileName = "/src/index.ts";
  const base = rustSourceTypeCarrier(fileName, "Base", "object");
  const derived = rustSourceTypeCarrier(fileName, "Derived", "object");
  const second = rustSourceTypeCarrier(fileName, "Second", "object");
  const string = rustStringTargetType();
  const source = rustSourceUnionTargetType(fileName, "Source");
  const target = rustSourceUnionTargetType(fileName, "Target");
  const inner = rustSourceUnionTargetType(fileName, "Inner");
  const registry = createRustTypeDefinitionRegistry();
  const variants = (carriers) => carriers.map((carrier, index) => ({ name: `Variant${index}`, carrier }));
  assert.equal(registry.registerSourceUnion({ carrier: source, variants: variants([string, derived, ...(siblings ? [second] : [])]) }, true), true);
  if (nested) assert.equal(registry.registerSourceUnion({ carrier: inner, variants: variants([base]) }, true), true);
  assert.equal(registry.registerSourceUnion({ carrier: target,
    variants: variants([string, nested ? inner : base, ...(retainDerived ? [derived] : [])]) }, true), true);
  const definitions = registry.seal();
  const classes = [base, derived, second].map(carrier => ({ carrier, kind: "class" }));
  const projectTypes = {
    definitionForCarrier: carrier => classes.find(definition => rustTargetTypeRefEquals(definition.carrier, carrier)),
    relationship: (carrier, definition) => {
      if (!rustTargetTypeRefEquals(definition.carrier, base) ||
        ![derived, second].some(candidate => rustTargetTypeRefEquals(candidate, carrier))) return { kind: "unrelated" };
      return relationKind === "related" ? { kind: "related", targetType: base } : { kind: relationKind };
    },
  };
  return { fileName, base, derived, second, source, target, inner, string, definitions, projectTypes };
}

test("nominal union widening composes existing checked upcasts inside canonical arm correspondence", () => {
  const { source, target, definitions, projectTypes, derived, base } = fixture();
  assert.equal(selectRustUnionArmMapping(source, target, "source", definitions), undefined);
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  assert.equal(conversion.kind, "project-union-map");
  assert.equal(conversion.arms[0].upcast, null);
  assert.deepEqual(conversion.arms[1].upcast, { sourceCarrier: derived, targetCarrier: base });
  assert.deepEqual(conversion.arms[1].target.map(step => step.variant.name), ["Variant1"]);
  assert.ok(Object.isFrozen(conversion) && Object.isFrozen(conversion.arms) && conversion.arms.every(Object.isFrozen));
  const relation = rustProjectUnionUpcastRelation(projectTypes);
  assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion, definitions, relation), true);
  assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion, definitions), false);
  assert.equal(rustContextualRuntimeConversionContract(conversion, definitions), undefined);
  assert.equal(rustContextualValueConversionIsFallible(conversion, definitions), false);
  assert.deepEqual(selectRustValueCarrierReconciliation(source, target, projectTypes, definitions), {
    kind: "conversion", fact: { sourceCarrier: source, targetCarrier: target, conversion },
  });
});

test("nominal mappings retain nested destinations, exact payload priority and complete source coverage", () => {
  const { source, target, definitions, projectTypes } = fixture({ siblings: true, nested: true });
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  assert.equal(conversion.arms.length, 3);
  assert.deepEqual(conversion.arms.slice(1).map(arm => arm.target.map(step => step.variant.name)),
    [["Variant1", "Variant0"], ["Variant1", "Variant0"]]);
  const selected = fixture({ retainDerived: true });
  assert.equal(selectRustProjectUnionMapping(selected.source, selected.target, selected.projectTypes, selected.definitions), undefined);
  const exact = selectRustUnionArmMapping(selected.source, selected.target, "source", selected.definitions,
    () => assert.fail("exact payloads do not consult broader project relations"));
  assert.deepEqual(exact.map(arm => arm.target[0].variant.name), ["Variant0", "Variant2"]);
  assert.equal(selectRustProjectUnionMapping(target, source, projectTypes, definitions), undefined);
  const duplicate = { ...definitions, programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, source)
    ? [definitions.sourceUnionVariants(source)[1], definitions.sourceUnionVariants(source)[2], definitions.sourceUnionVariants(source)[1]]
    : definitions.sourceUnionVariants(carrier) };
  assert.equal(selectRustProjectUnionMapping(source, target, projectTypes, duplicate), undefined);
  for (const relationKind of ["unrelated", "ambiguous"]) {
    const changed = fixture({ relationKind });
    assert.equal(selectRustProjectUnionMapping(changed.source, changed.target, changed.projectTypes, changed.definitions), undefined);
  }
  const alternate = rustSourceTypeCarrier("/src/index.ts", "Alternate", "object");
  const ambiguous = { ...definitions, programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, target)
    ? [{ name: "String", carrier: rustStringTargetType() },
      { name: "First", carrier: conversion.arms[1].upcast.targetCarrier }, { name: "Second", carrier: alternate }]
    : definitions.sourceUnionVariants(carrier) };
  assert.equal(selectRustProjectUnionMapConversion(source, target, ambiguous, () => "related"), undefined);
});

test("project union admission rejects nonproject source families, widths, borrowed carriers and stale generic relations", () => {
  const original = fixture();
  const { source, target, definitions, projectTypes, base, derived } = original;
  const integer = rustSourcePrimitiveTargetType("uint64");
  const genericBase = rustSourceTypeCarrier(original.fileName, "Base", "object", [{ kind: "type", type: integer }]);
  const cases = [integer, rustSourcePrimitiveTargetType("int64"),
    { kind: "target-named", id: "native.Derived" },
    rustSourceTypeCarrier(original.fileName, "Derived", "enum"),
    { kind: "reference", referent: derived, mutable: false, lifetime: { kind: "static" } },
    rustOptionTargetType(derived), rustJsPromiseTargetTypeWithLifetime(derived, { kind: "static" }),
  ];
  for (const candidate of cases) {
    const changed = { ...definitions, programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, source)
      ? [{ name: "Payload", carrier: candidate }] : definitions.sourceUnionVariants(carrier) };
    assert.equal(selectRustProjectUnionMapConversion(source, target, changed, () => "related"), undefined);
  }
  assert.equal(selectRustProjectUnionMapping(source, target,
    { ...projectTypes, relationship: () => ({ kind: "related", targetType: genericBase }) }, definitions), undefined);
  assert.equal(selectRustProjectUnionMapping(source, target,
    { ...projectTypes, definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, derived)
      ? undefined : projectTypes.definitionForCarrier(carrier) }, definitions), undefined);
  const cycle = { programErrorOrigin: () => undefined, sourceUnionVariants: () => [{ name: "Loop", carrier: source }] };
  assert.equal(selectRustProjectUnionMapping(source, target, projectTypes, cycle), undefined);
  const numeric = { ...definitions, programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, target)
    ? [{ name: "Value", carrier: integer }] : [{ name: "Value", carrier: base }] };
  assert.equal(selectRustProjectUnionMapConversion(source, target, numeric, () => "related"), undefined);
});

test("project union facts reject omitted proof, forged paths, getters, cycles and stale sealed relationships", () => {
  const { source, target, definitions, projectTypes, derived } = fixture();
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  const relation = rustProjectUnionUpcastRelation(projectTypes);
  let getterCalls = 0;
  const getter = { ...conversion.arms[1].upcast };
  Object.defineProperty(getter, "targetCarrier", { enumerable: true, get() { getterCalls++; throw new Error("must not run"); } });
  const cycle = { ...conversion.arms[1].upcast };
  cycle.sourceCarrier = cycle;
  for (const arms of [conversion.arms.slice(1), conversion.arms.toReversed(), [...conversion.arms, conversion.arms[1]],
    conversion.arms.map(({ upcast, ...arm }) => arm),
    conversion.arms.map(arm => ({ ...arm, upcast: null })),
    conversion.arms.map((arm, index) => index === 1 ? { ...arm, upcast: { ...arm.upcast, targetCarrier: derived } } : arm),
    conversion.arms.map((arm, index) => index === 1 ? { ...arm, upcast: { ...arm.upcast, sourceVariants: [] } } : arm),
    conversion.arms.map((arm, index) => index === 1 ? { ...arm, upcast: getter } : arm),
    conversion.arms.map((arm, index) => index === 1 ? { ...arm, upcast: cycle } : arm),
    conversion.arms.map((arm, index) => index === 1 ? { ...arm, target: [{ union: target, variant: { kind: "payload", name: "Missing" } }] } : arm),
  ]) assert.equal(rustProjectUnionMapConversionMatches({ ...conversion, arms }, source, target, definitions, relation), false);
  assert.equal(getterCalls, 0);
  assert.equal(isRustProjectUnionMapConversion({ ...conversion, extra: true }), false);
  assert.equal(rustProjectUnionMapConversionMatches(conversion, target, source, definitions, relation), false);
  assert.equal(rustProjectUnionMapConversionMatches(conversion, source, target, definitions, () => "unrelated"), false);
  assert.equal(rustProjectUnionMapConversionMatches(conversion, source, target,
    { programErrorOrigin: () => undefined, sourceUnionVariants: () => undefined }, relation), false);
});

test("canonical nominal union emission moves owned fields and borrows views without a redundant Derived clone", () => {
  const { source, target, definitions, projectTypes, fileName } = fixture();
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName, text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) }, typeDefinitions: definitions,
    projectTypes, valueLifetimes: { canMove: () => true },
    names: { nameForSourceType: (_file, name) => name }, configuration: { edition: "2024" } } },
    sourceFile, diagnostics: [], moduleName: "index", moduleNameByFileName: new Map([[fileName, "index"]]),
    externalCrateNameByFileName: new Map() };
  const expression = { kind: "call", path: "produce", args: [] };
  for (const owned of [true, false]) {
    const planned = planRustProjectUnionMapping(node, expression, conversion, source, target, context, owned,
      (value, fact, owned) => planRustProjectUpcast(node, value, fact, fact.sourceCarrier, context, owned ? "owned" : "borrowed"));
    assert.equal(planned.kind, "match");
    assert.deepEqual(planned.expression, owned ? expression : { kind: "reference", expr: expression });
    assert.equal(planned.arms.length, 2);
    const upcast = planned.arms[1].expression.args[0];
    assert.equal(upcast.kind, "block");
    assert.equal(upcast.body.statements.length, 2);
    assert.equal(upcast.body.statements[0].kind, "let");
    assert.equal(upcast.body.statements[0].init.kind, "path");
    assert.equal(upcast.body.statements[1].kind, "tail");
    const constructed = upcast.body.statements[1].expr;
    assert.equal(constructed.kind, "struct-literal");
    assert.equal(constructed.path, "Base");
    assert.deepEqual(constructed.fields.map(field => field.name), ["identity", "dispatch"]);
    for (const field of constructed.fields) {
      assert.equal(field.value.kind, owned ? "field" : "method-call");
      if (!owned) assert.equal(field.value.method, "clone");
    }
    assert.doesNotMatch(JSON.stringify(upcast), /Box|Rc::|RefCell|Any|downcast|reflect|alloc/u);
    if (owned) assert.doesNotMatch(JSON.stringify(planned), /clone/u);
  }
  const failed = planRustProjectUnionMapping(node, expression, conversion, source, target, context, true, () => undefined);
  assert.equal(failed, undefined);
  for (const [actualSource, actualTarget] of [[target, target], [source, source]]) {
    assert.equal(planRustProjectUnionMapping(node, expression, conversion, actualSource, actualTarget,
      context, true, () => assert.fail("inconsistent outer carriers cannot emit an upcast")), undefined);
    assert.equal(applyRustCallableValueAdapterRaw(expression, { kind: "conversion", sourceCarrier: actualSource,
      targetCarrier: actualTarget, conversion }, node, context), undefined);
  }
  const adapted = applyRustCallableValueAdapterRaw(expression,
    { kind: "conversion", sourceCarrier: source, targetCarrier: target, conversion }, node, context);
  assert.equal(adapted.fallible, false);
  assert.equal(adapted.expression.kind, "match");
  assert.deepEqual(adapted.expression.expression, expression);
  assert.doesNotMatch(JSON.stringify(adapted), /clone|Box|Rc::|RefCell|Any|downcast|reflect|alloc/u);
  const contextual = { sourceCarrier: source, targetCarrier: target, conversion };
  const projected = planExpression(node, { ...context,
    expressionOverrides: new Map([[node, { expression, carrier: source, valueForm: "owned" }]]),
    input: { program: { ...context.input.program, facts: {
      getFact: (subject, key) => subject === node && key === rustContextualValueConversionFactKey ? contextual : undefined,
      getRuntimeCarrierFact: subject => subject === node ? { carrier: source } : undefined,
      getTargetConversionFact: () => undefined,
    } } },
  });
  assert.deepEqual(projected, adapted.expression);
  assert.deepEqual(context.diagnostics, []);
});

test("nominal union liveness reuses exact upcast fields and retains every nested source and target path", () => {
  const { source, target, definitions, projectTypes, fileName, base, derived, second } = fixture({ siblings: true, nested: true });
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName, text: "value", statements: [node] });
  const ast = { ...fakeAstReader([sourceFile]), forEachChild: (current, visit) => {
    if (current === sourceFile) visit(node);
  } };
  const classes = [base, derived, second].map(carrier => ({ carrier, kind: "class",
    declaration: fakeStatement({ kindName: "KindClassDeclaration" }) }));
  const unused = fakeStatement({ kindName: "KindClassDeclaration" });
  const usage = analyzeRustGeneratedItemUsage({ ast, sourceFiles: [sourceFile], declarations: [],
    facts: { getFact: (subject, key) => subject === node && key === rustContextualValueConversionFactKey
      ? { sourceCarrier: source, targetCarrier: target, conversion } : undefined,
      getRuntimeCarrierFact: () => undefined },
    projectTypes: { ...projectTypes, definitions: classes, isPolymorphic: () => false,
      definitionForDeclaration: () => undefined,
      definitionForCarrier: carrier => classes.find(definition => rustTargetTypeRefEquals(definition.carrier, carrier)) },
    classValues: { instanceViews: [], instanceViewFor: () => undefined }, declarationGenericRequirements: { projectionImplementationsFor: () => [] },
    typeDefinitions: definitions,
    structuralShapes: { unionForCarrier: () => undefined },
  });
  for (const arm of conversion.arms) {
    for (const step of [...arm.source, ...arm.target]) {
      assert.equal(usage.isUnionVariantUsed(step.union, step.variant.name), true);
    }
  }
  for (const definition of classes) {
    assert.equal(usage.isProjectTypeUsed(definition.declaration), true);
    assert.equal(usage.isProjectTypeConstructed(definition.declaration), rustTargetTypeRefEquals(definition.carrier, base));
    assert.equal(usage.isProjectConstructorInvoked(definition.declaration), false);
    for (const role of ["wrapper-identity", "wrapper-dispatch"]) {
      assert.equal(usage.isProjectGeneratedFieldUsed(definition.declaration, role),
        !rustTargetTypeRefEquals(definition.carrier, base));
    }
  }
  assert.equal(usage.isProjectTypeUsed(unused), false);
  assert.equal(usage.isUnionVariantUsed(target, "Missing"), false);
});

test("dispatcher fuses finalized narrowing and heritage without intermediate enum or identity clones", () => {
  const { source, target, definitions: originalDefinitions, projectTypes, fileName, string, derived } = fixture({ nested: true });
  const root = rustSourceUnionTargetType(fileName, "Root");
  const definitions = { ...originalDefinitions, programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, root)
    ? [{ name: "Excluded", carrier: rustSourcePrimitiveTargetType("bool") },
      { name: "Object", carrier: derived }, { name: "Text", carrier: string }]
    : originalDefinitions.sourceUnionVariants(carrier) };
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  const correspondence = conversion.arms.map(({ upcast, ...mapping }) => mapping);
  const relation = rustProjectUnionUpcastRelation(projectTypes);
  const node = fakeStatement({ kindName: "KindIdentifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName, text: "value", statements: [node] });
  const ast = fakeAstReader([sourceFile]);
  Object.assign(ast.is, { IsIdentifier: current => current === node, IsAsExpression: () => false,
    IsSatisfiesExpression: () => false, IsNonNullExpression: () => false, IsTypeAssertion: () => false });
  for (const absent of [false, true]) {
    const rawCarrier = absent ? rustOptionTargetType(root) : root;
    const selectedFlow = selectRustFlowReadProjection(rawCarrier, source, projectTypes, definitions);
    assert.equal(selectedFlow.kind, "projection");
    const flow = selectedFlow.fact;
    assert.equal(flow.kind, "union-map");
    const composed = composeRustUnionArmMappings(root, source, target, flow.arms, correspondence,
      definitions, (left, right) => relation(left, right) === "related");
    assert.deepEqual(composed.map(mapping => mapping.source.map(step => step.variant.name)), [["Text"], ["Object"]]);
    assert.deepEqual(composed.map(mapping => mapping.target.map(step => step.variant.name)),
      [["Variant0"], ["Variant1", "Variant0"]]);
    assert.ok(Object.isFrozen(composed) && composed.every(Object.isFrozen));
    for (const owned of [true, false]) {
      const original = { kind: "path", path: "value" };
      const expression = owned ? { kind: "call", path: "produce", args: [] }
        : { kind: "method-call", receiver: original, method: "clone", args: [] };
      const context = { input: { program: { source: { ast }, typeDefinitions: definitions, projectTypes,
        valueLifetimes: { canMove: () => owned }, callableValues: { generic: { definitionFor: () => undefined } },
        names: { nameForSourceType: (_file, name) => name }, configuration: { edition: "2024" },
        facts: { getFact: (subject, key) => subject !== node ? undefined
          : key === rustFlowReadProjectionFactKey ? flow
            : key === rustContextualValueConversionFactKey ? { sourceCarrier: source, targetCarrier: target, conversion } : undefined,
          getRuntimeCarrierFact: subject => subject === node ? { carrier: rawCarrier } : undefined,
          getTargetConversionFact: () => undefined } } },
        expressionOverrides: new Map([[node, { expression, carrier: rawCarrier, valueForm: "owned" }]]),
        sourceFile, diagnostics: [], moduleName: "index", moduleNameByFileName: new Map([[fileName, "index"]]),
        externalCrateNameByFileName: new Map() };
      const planned = planExpression(node, context);
      assert.equal(planned.kind, "match");
      assert.deepEqual(planned.expression, owned ? expression : { kind: "reference", expr: original });
      assert.equal(planned.arms.length, 3);
      assert.equal(planned.arms[2].pattern.kind, "wildcard");
      assert.equal(planned.arms[2].expression.kind, "unreachable");
      const rendered = JSON.stringify(planned);
      assert.equal((rendered.match(/"kind":"match"/gu) ?? []).length, 1);
      assert.equal((rendered.match(/"path":"produce"/gu) ?? []).length, owned ? 1 : 0);
      assert.equal((rendered.match(/"method":"clone"/gu) ?? []).length, owned ? 0 : 3);
      assert.doesNotMatch(rendered, /Source::|Box|Rc::|RefCell|Any|downcast|reflect|alloc/u);
      if (absent) assert.ok(planned.arms.slice(0, 2).every(arm => arm.pattern.path === "Some"));
      assert.deepEqual(context.diagnostics, []);
      if (!absent && !owned) {
        const direct = planExpression(node, { ...context,
          expressionOverrides: new Map([[node, { expression, carrier: source, valueForm: "owned" }]]),
          input: { program: { ...context.input.program, facts: {
            ...context.input.program.facts,
            getFact: (subject, key) => key === rustFlowReadProjectionFactKey ? undefined
              : context.input.program.facts.getFact(subject, key),
            getRuntimeCarrierFact: subject => subject === node ? { carrier: source } : undefined,
          } } },
        });
        assert.equal(direct.kind, "match");
        assert.deepEqual(direct.expression, { kind: "reference", expr: original });
        assert.equal((JSON.stringify(direct).match(/"method":"clone"/gu) ?? []).length, 3);
      }
      assert.equal(composeRustUnionArmMappings(root, source, target, [...flow.arms].toReversed(), correspondence,
        definitions, (left, right) => relation(left, right) === "related"), undefined);
      assert.equal(composeRustUnionArmMappings(root, source, target, flow.arms, correspondence,
        definitions, () => false), undefined);
      assert.equal(planRustProjectUnionMapping(node, original, conversion, source, target, context, false,
        () => assert.fail("forged flow cannot reach native upcast"), { ...flow, arms: flow.arms.slice(1) }), undefined);
      let getterCalls = 0;
      const getter = { ...flow };
      Object.defineProperty(getter, "selectedCarrier", { enumerable: true, get() { getterCalls++; return source; } });
      const cycle = { ...flow };
      cycle.sourceCarrier = cycle;
      for (const stale of [getter, cycle, { ...flow, extra: true }, { ...flow, selectedCarrier: target },
        { ...flow, sourceCarrier: rustOptionTargetType(derived) }]) {
        assert.equal(planRustProjectUnionMapping(node, original, conversion, source, target, context, false,
          () => assert.fail("malformed upstream metadata cannot reach native upcast"), stale), undefined);
      }
      assert.equal(getterCalls, 0);
    }
  }
});
