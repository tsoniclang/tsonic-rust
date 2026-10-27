import { createRustOwnershipFixture } from "../../../helpers/ownership.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { prepareRustProjectGenericMembership } from "../../../../dist/analysis/project-types/generic-membership.js";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier, rustSourceUnionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType,
  rustOptionTargetType, rustJsPromiseTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { composeRustUnionArmMappings, selectRustUnionArmMapping } from "../../../../dist/policy/conversions/union-relations.js";
import { selectRustProjectUnionMapConversion, isRustProjectUnionMapConversion, rustProjectUnionMapConversionMatches } from "../../../../dist/policy/conversions/project-union.js";
import { rustCompilerOwnedContextualConversionMatches, rustContextualRuntimeConversionContract, rustContextualValueConversionIsFallible } from "../../../../dist/policy/conversions/contextual.js";
import { selectRustProjectUnionMapping } from "../../../../dist/policy/types/project/project-union-mappings.js";
import { selectRustCallableValueAdapter } from "../../../../dist/policy/conversions/callable-adapters.js";
import { rustProjectUnionUpcastRelation } from "../../../../dist/policy/model/project-union-relations.js";
import { selectRustFlowReadProjection, selectRustValueCarrierReconciliation } from "../../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { planRustProjectUnionMapping } from "../../../../dist/backend/planner/expressions/project-union-mappings.js";
import { planExpression, planRustProjectUpcast } from "../../../../dist/backend/planner/expressions/entry.js";
import { applyRustCallableValueAdapterRaw } from "../../../../dist/backend/planner/declarations/callables/adapters.js";
import { analyzeRustGeneratedItemUsage } from "../../../../dist/analysis/reachability/generated-item-usage.js";

import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustProgramSourceFiles, rustSourceFilePlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";
import { createRustPlanningContext } from "../../../../dist/backend/planner/context.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { analyzeRustProjectEmission } from "../../../../dist/analysis/project-types/emission.js";
import { createRustProjectEmissionProducer } from "../../../../dist/analysis/program/records/program/project-emission.js";
import { analyzeRustTypeEmission } from "../../../../dist/analysis/source-evidence/types/emission.js";
import { createRustTypeEmissionProducer } from "../../../../dist/analysis/program/records/types/type-emission.js";
import { analyzeRustValueReads } from "../../../../dist/analysis/conversions/value-reads.js";
import { createRustValueReadProducer } from "../../../../dist/analysis/program/records/storage/value-read.js";
import { createRustValueProjectionProducer } from "../../../../dist/analysis/program/records/objects/value-projection.js";
import { createRustConversionEmissionProducer } from "../../../../dist/analysis/program/records/operations/conversion-emission.js";
import { createRustOwnershipEmissionProducer } from "../../../../dist/analysis/program/records/storage/ownership-emission.js";
import { analyzeRustProjectUnionMappings } from "../../../../dist/analysis/conversions/project-union-mappings.js";
import { createRustProjectUnionMappingProducer } from "../../../../dist/analysis/program/records/types/project-union-mappings.js";

function fixture({ siblings = false, nested = false, retainDerived = false, relationKind = "related", includeRoot = false } = {}) {
  const fileName = "/src/index.ts";
  const base = rustSourceTypeCarrier(fileName, "Base", "object");
  const derived = rustSourceTypeCarrier(fileName, "Derived", "object");
  const second = rustSourceTypeCarrier(fileName, "Second", "object");
  const string = rustStringTargetType();
  const source = rustSourceUnionTargetType(fileName, "Source");
  const target = rustSourceUnionTargetType(fileName, "Target");
  const inner = rustSourceUnionTargetType(fileName, "Inner");
  const root = rustSourceUnionTargetType(fileName, "Root");
  const registry = createRustTypeDefinitionRegistry();
  const variants = (carriers) => carriers.map((carrier, index) => ({ name: `Variant${index}`, carrier }));
  assert.equal(registry.registerSourceUnion({ carrier: source, variants: variants([string, derived, ...(siblings ? [second] : [])]) }, true), true);
  if (nested) assert.equal(registry.registerSourceUnion({ carrier: inner, variants: variants([base]) }, true), true);
  assert.equal(registry.registerSourceUnion({ carrier: target,
    variants: variants([string, nested ? inner : base, ...(retainDerived ? [derived] : [])]) }, true), true);
  if (includeRoot) assert.equal(registry.registerSourceUnion({ carrier: root, variants: [
    { name: "Excluded", carrier: rustSourcePrimitiveTargetType("bool") },
    { name: "Object", carrier: derived }, { name: "Text", carrier: string },
  ] }, true), true);
  const definitions = registry.seal();
  const classes = [base, derived, second].map(carrier => ({ carrier, kind: "class", genericParameters: [],
    declaration: fakeStatement({ kindName: "KindClassDeclaration" }) }));
  const genericContracts = new Map(classes.map(definition => [definition.declaration,
    { typeParameters: [], associatedTypes: [], optionalStorage: [] }]));
  const declarationGenericRequirements = { contractFor: declaration => genericContracts.get(declaration) };
  const projectTypes = {
    definitionForCarrier: carrier => classes.find(definition => rustTargetTypeRefEquals(definition.carrier, carrier)),
    relationship: (carrier, definition) => {
      if (!rustTargetTypeRefEquals(definition.carrier, base) ||
        ![derived, second].some(candidate => rustTargetTypeRefEquals(candidate, carrier))) return { kind: "unrelated" };
      return relationKind === "related" ? { kind: "related", targetType: base } : { kind: relationKind };
    },
  };
  return { fileName, base, derived, second, source, target, inner, root, string, definitions, projectTypes,
    declarationGenericRequirements };
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
    rustOptionTargetType(derived), rustJsPromiseTargetType(derived),
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

const wideningSource = `
class Base { value: number = 3; read(): number { return this.value; } }
class Derived extends Base { read(): number { return this.value + 1; } }
type Narrow = string | Derived;
type Wide = string | Base;
export function widen(value: Narrow): Wide { return value; }
`;

// The checked return of widen: its contextual project-union-map record and the sealed program that holds it.
function compiledWidening() {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": wideningSource } });
  const { ast } = program.source;
  const widened = [];
  const visit = node => {
    if (program.records.contextualValueConversion.get(node)?.conversion.kind === "project-union-map") widened.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  rustProgramSourceFiles(program).forEach(visit);
  assert.equal(widened.length, 1, "one checked nominal union widening");
  const [node] = widened;
  return { program, node, contextual: program.records.contextualValueConversion.get(node) };
}

function planWidening(program, node, contextual, expression, owned, project) {
  const context = rustSourceFilePlanContext(program, node);
  return planRustProjectUnionMapping(node, expression, contextual.conversion, contextual.sourceCarrier,
    contextual.targetCarrier, context, owned, project ?? ((value, fact, owns) =>
      planRustProjectUpcast(node, value, fact, context, owns ? "owned" : "borrowed")));
}

test("canonical nominal union emission moves owned fields and borrows views without a redundant Derived clone", () => {
  const { program, node, contextual } = compiledWidening();
  const expression = { kind: "call", path: "produce", args: [] };
  for (const owned of [true, false]) {
    const planned = planWidening(program, node, contextual, expression, owned);
    assert.equal(planned.kind, "match");
    assert.deepEqual(planned.expression, owned ? expression : { kind: "reference", expr: expression });
    assert.equal(planned.arms.length, 2);
    const upcasts = planned.arms.map(arm => arm.expression.args?.[0]).filter(value => value?.kind === "block");
    assert.equal(upcasts.length, 1, "only the Derived arm is upcast");
    const [upcast] = upcasts;
    assert.equal(upcast.body.statements.length, 2);
    assert.equal(upcast.body.statements[0].kind, "let");
    assert.equal(upcast.body.statements[0].init.kind, owned ? "path" : "reference");
    if (!owned) assert.equal(upcast.body.statements[0].init.expr.kind, "path", "a borrowed native view binds the original payload reference");
    assert.equal(upcast.body.statements[1].kind, "tail");
    const constructed = upcast.body.statements[1].expr;
    assert.equal(constructed.kind, "struct-literal");
    assert.match(constructed.path, /(^|::)Base$/u);
    assert.deepEqual(constructed.fields.map(field => field.name), ["identity", "dispatch"]);
    for (const field of constructed.fields) {
      assert.equal(field.value.kind, owned ? "field" : "method-call");
      if (!owned) assert.equal(field.value.method, "clone");
    }
    assert.doesNotMatch(JSON.stringify(upcast), /Box|Rc::|RefCell|Any|downcast|reflect|alloc/u);
    if (owned) assert.doesNotMatch(JSON.stringify(planned), /clone/u);
  }
  assert.throws(() => planWidening(program, node, contextual, expression, true, () => undefined),
    /An admitted union map requires its native payload value/u);
  const viaRecord = planExpression(node, rustSourceFilePlanContext(program, node));
  assert.deepEqual(viaRecord, planWidening(program, node, contextual, { kind: "path", path: "value" }, true));
});

test("callable adapters plan the same nominal union mapping as the contextual record", () => {
  const { program, node, contextual } = compiledWidening();
  const expression = { kind: "call", path: "produce", args: [] };
  const adapter = selectRustCallableValueAdapter(contextual.sourceCarrier, contextual.targetCarrier,
    program.projectTypes, program.typeDefinitions);
  const adapted = applyRustCallableValueAdapterRaw(expression, adapter, node, rustSourceFilePlanContext(program, node));
  assert.equal(adapted.fallible, false);
  assert.equal(adapted.expression.kind, "match");
  assert.deepEqual(adapted.expression.expression, expression);
  assert.doesNotMatch(JSON.stringify(adapted), /clone|Box|Rc::|RefCell|Any|downcast|reflect|alloc/u);
  assert.deepEqual(adapted.expression, planWidening(program, node, contextual, expression, true));
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
  const unionCarriers = new Map([source, target, ...conversion.arms.flatMap(arm =>
    [...arm.source, ...arm.target].map(step => step.union))].map(carrier => [
    fakeStatement({ kindName: "KindTypeAliasDeclaration" }), carrier,
  ]));
  const usage = analyzeRustGeneratedItemUsage({ ast, sourceFiles: [sourceFile], declarations: [...unionCarriers.keys()],
    nativeNodes: [sourceFile, node],
    records: createRustRecordFixture({contextualValueConversion: { get: (subject) => subject === node
    ? { sourceCarrier: source, targetCarrier: target, conversion } : undefined },
runtimeCarrier: { get: subject => unionCarriers.has(subject) ? { carrier: unionCarriers.get(subject) } : undefined }}),
    projectTypes: { ...projectTypes, definitions: classes, isPolymorphic: () => false,
      definitionForDeclaration: () => undefined,
      definitionForCarrier: carrier => classes.find(definition => rustTargetTypeRefEquals(definition.carrier, carrier)) },
    classValues: { instanceViews: [], instanceViewFor: () => undefined }, declarationGenericRequirements: { projectionImplementationsFor: () => [] },
    typeDefinitions: definitions,
    typeFamilies: { implementations: [] },
    structuralShapes: { definitions: [], unionDefinitions: [], unionForCarrier: () => undefined, definitionForCarrier: () => undefined },
  });
  for (const arm of conversion.arms) {
    for (const step of [...arm.source, ...arm.target]) {
      assert.equal(usage.structuralCarriers.get(step.union)?.variants.used.has(step.variant.name) === true, true);
    }
    for (const step of arm.source) {
      assert.equal(usage.structuralCarriers.get(step.union)?.variants.constructed.has(step.variant.name) === true, false, "a match reads its input variant");
      assert.equal(usage.structuralCarriers.get(step.union)?.variants.read.has(step.variant.name) === true, true, "mapping consumes its input payload");
    }
    for (const step of arm.target) {
      assert.equal(usage.structuralCarriers.get(step.union)?.variants.constructed.has(step.variant.name) === true, true, "a mapping constructs its output variant");
      assert.equal(usage.structuralCarriers.get(step.union)?.variants.read.has(step.variant.name) === true, false, "construction is not a payload read");
    }
  }
  for (const definition of classes) {
    assert.equal(usage.usedProjectTypes.has(definition.declaration), true);
    assert.equal(usage.constructedProjectTypes.has(definition.declaration), rustTargetTypeRefEquals(definition.carrier, base));
    assert.equal(usage.invokedProjectConstructors.has(definition.declaration), false);
    for (const role of ["wrapper-identity", "wrapper-dispatch"]) {
      assert.equal(usage.usedProjectFields.get(definition.declaration)?.has(role) === true,
        !rustTargetTypeRefEquals(definition.carrier, base));
    }
  }
  assert.equal(usage.usedProjectTypes.has(unused), false);
  assert.equal(usage.structuralCarriers.get(target)?.variants.used.has("Missing") === true, false);
  assert.equal(usage.structuralCarriers.get(target)?.variants.constructed.has("Missing") === true, false);
  assert.equal(usage.structuralCarriers.get(target)?.variants.read.has("Missing") === true, false);
});

test("dispatcher fuses finalized narrowing and heritage without intermediate enum or identity clones", () => {
  const { source, target, root, derived, base: baseCarrier, inner, string: stringCarrier,
    definitions, projectTypes, fileName, declarationGenericRequirements } =
    fixture({ nested: true, includeRoot: true });
  const conversion = selectRustProjectUnionMapping(source, target, projectTypes, definitions);
  const correspondence = conversion.arms.map(({ upcast, ...mapping }) => mapping);
  const relation = rustProjectUnionUpcastRelation(projectTypes);
  const node = fakeStatement({ kindName: "KindIdentifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName, text: "value", statements: [node] });
  const ast = fakeAstReader([sourceFile]);
  Object.assign(ast.is, { IsIdentifier: current => current === node, IsAsExpression: () => false,
    IsSatisfiesExpression: () => false, IsNonNullExpression: () => false, IsTypeAssertion: () => false });
  const base = rustProgramWithTypeEmissions([source, target, root, inner, derived, baseCarrier, stringCarrier,
    rustOptionTargetType(root)], { typeDefinitions: definitions, source: `
export class Base {}
export class Derived extends Base {}
export class Second extends Base {}
export function probe(): void {}
` });
  const prepare = raw => {
    const ownership = createRustOwnershipEmissionProducer(() => {});
    ownership.publish(raw.ownership);
    const program = { ...base, ...raw, source: { ...base.source, ast },
      projectTypes: base.projectTypes,
      callableValues: base.callableValues, classValues: base.classValues,
      declarationGenericRequirements: base.declarationGenericRequirements,
      names: { ...base.names, nameForSourceType: (_file, name) => name },
      records: createRustRecordFixture({ flowReadProjection: raw.records.flowReadProjection,
        contextualValueConversion: raw.records.contextualValueConversion, runtimeCarrier: raw.records.runtimeCarrier,
        conversion: raw.records.conversion, ...ownership.records }, base.records) };
    const projects = createRustProjectEmissionProducer(() => {});
    analyzeRustProjectEmission({ program, nodes: [], producer: projects,
      memberships: prepareRustProjectGenericMembership(program.declarationGenericRequirements) });
    const catalogued = { ...program, records: { ...program.records, ...projects.records } };
    const types = createRustTypeEmissionProducer(() => {});
    analyzeRustTypeEmission(catalogued, [], types, [source, target, root, inner, derived, baseCarrier, stringCarrier,
      rustOptionTargetType(root)], projects);
    const admitted = { ...catalogued, records: { ...catalogued.records, ...types.records } };
    const reads = createRustValueReadProducer(() => {});
    const projections = createRustValueProjectionProducer(() => {});
    const conversions = createRustConversionEmissionProducer(() => {});
    const issues = analyzeRustValueReads(admitted, [node], [], reads, projections, conversions);
    assert.equal(issues.length, 0, "the actual pre-seal owner admits the ordered source-to-contextual composition");
    const mappings = createRustProjectUnionMappingProducer(() => {});
    const mappingIssues = analyzeRustProjectUnionMappings(admitted, [node], mappings);
    assert.equal(mappingIssues.length, 0, "one actual native owner seals the exact composed arms");
    return { ...admitted, records: { ...admitted.records, ...reads.records, ...projections.records, ...conversions.records, ...mappings.records } };
  };
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
        : original;
      const context = { input: { program: { source: { ast }, typeDefinitions: definitions, projectTypes,
        ownership: createRustOwnershipFixture(node, rawCarrier, owned ? "move" : "clone"), declarationGenericRequirements,
        callableValues: { generic: { definitionFor: () => undefined }, native: { protocolForSourceItem: () => undefined } },
        names: { nameForSourceType: (_file, name) => name }, configuration: { edition: "2024" },
        records: createRustRecordFixture({flowReadProjection: { get: (subject) => subject !== node ? undefined
    : flow },
contextualValueConversion: { get: (subject) => subject !== node ? undefined
    :
        { sourceCarrier: source, targetCarrier: target, conversion } },
runtimeCarrier: { get: (subject) => subject === node ? { carrier: rawCarrier } : undefined },
conversion: { get: () => undefined }}) } },
        expressionOverrides: new Map([[node, { expression, carrier: rawCarrier, valueForm: "owned" }]]),
        sourceFile, nativeHeaderPlacement: sourceFile, nativeHeaderParent: undefined, diagnostics: [], moduleName: "index", moduleNameByFileName: new Map([[fileName, "index"]]),
        externalCrateNameByFileName: new Map() };
      const raw = context.input.program;
      context.input = createRustPlanningContext(prepare(raw));
      context.syntheticNames = createRustSyntheticNameState(ast, node, []);
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
      assertNoTargetDiagnostics(context.diagnostics);
      if (!absent && !owned) {
        const direct = planExpression(node, { ...context,
          expressionOverrides: new Map([[node, { expression, carrier: source, valueForm: "owned" }]]),
          input: createRustPlanningContext(prepare({ ...raw, records: createRustRecordFixture({
flowReadProjection: { get: (subject) => undefined },
runtimeCarrier: { get: (subject) => subject === node ? { carrier: source } : undefined }}, raw.records) })),
        });
        assert.equal(direct.kind, "match");
        assert.deepEqual(direct.expression, { kind: "reference", expr: original });
        assert.equal((JSON.stringify(direct).match(/"method":"clone"/gu) ?? []).length, 3);
      }
      assert.equal(composeRustUnionArmMappings(root, source, target, [...flow.arms].toReversed(), correspondence,
        definitions, (left, right) => relation(left, right) === "related"), undefined);
      assert.equal(composeRustUnionArmMappings(root, source, target, flow.arms, correspondence,
        definitions, () => false), undefined);
      const missingComposition = error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
        error.diagnostic.sourceNode === node && error.diagnostic.message ===
          "An admitted project union conversion requires its sealed native arm composition.";
      assert.throws(() => planRustProjectUnionMapping(node, original, conversion, source, target, context, false,
        () => assert.fail("forged flow cannot reach native upcast"), { ...flow, arms: flow.arms.slice(1) }), missingComposition);
      let getterCalls = 0;
      const getter = { ...flow };
      Object.defineProperty(getter, "selectedCarrier", { enumerable: true, get() { getterCalls++; return source; } });
      const cycle = { ...flow };
      cycle.sourceCarrier = cycle;
      for (const stale of [getter, cycle, { ...flow, extra: true }, { ...flow, selectedCarrier: target },
        { ...flow, sourceCarrier: rustOptionTargetType(derived) }]) {
        assert.throws(() => planRustProjectUnionMapping(node, original, conversion, source, target, context, false,
          () => assert.fail("malformed upstream metadata cannot reach native upcast"), stale), missingComposition);
      }
      assert.equal(getterCalls, 0);
    }
  }
});
