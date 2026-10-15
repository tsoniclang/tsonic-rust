import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan, createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { rustGenericCallableTargetType, rustGenericCallableProtocol, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";

test("structural storage unifies exact component contracts without erasing other differences", () => {
  const primitive = name => ({ kind: "source-primitive", name });
  const field = (type, properties = {}) => ({ sourceName: "count", type, presence: "required", readonly: false, ...properties });
  const shapes = [
    ["/first.ts", field(primitive("int32"))],
    ["/second.ts", field(primitive("int32"))],
    ["/external.ts", field(primitive("int32"))],
    ["/width.ts", field(primitive("int64"))],
    ["/signed.ts", field(primitive("uint32"))],
    ["/optional.ts", field(primitive("int32"), { presence: "optional" })],
    ["/readonly.ts", field(primitive("int32"), { readonly: true })],
    ["/accessor.ts", field(primitive("int32"), { accessor: { getter: true, setter: true } })],
  ].map(([owner, value]) => ({
    sourceType: {}, carrier: rustStructuralObjectTargetType(owner, [value]), storage: "structural-object", fields: [],
  }));
  const plan = createRustStructuralShapePlan(shapes, [], file => file === "/external.ts" ? "dependency" : "app", [], [], []);
  assert.equal(plan.definitions.length, 7);
  const selected = shapes.map(shape => plan.definitionForCarrier(shape.carrier));
  assert.equal(selected[0].targetName, selected[1].targetName);
  assert.notEqual(selected[0].componentId, selected[2].componentId);
  for (const other of selected.slice(3)) assert.notEqual(other.targetName, selected[0].targetName);
  assert.equal(selected[0].carrier, shapes[0].carrier);
  assert.equal(selected[1].carrier, shapes[1].carrier);
  assert.equal(plan.sharesStorage(shapes[0].carrier, shapes[1].carrier), true);
  for (const other of shapes.slice(2)) {
    assert.equal(plan.sharesStorage(shapes[0].carrier, other.carrier), false);
  }
  assert.equal(plan.sharesStorage(shapes[0].carrier, primitive("int32")), false);
});

test("structural stored callable lifetimes instantiate through exact generic layout evidence", () => {
  const integer = { kind: "source-primitive", name: "int64" };
  const floating = { kind: "source-primitive", name: "float64" };
  const carrier = (lifetime, value = integer, readonly = false) => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "callback", type: rustCallableTargetType([value], value, lifetime), presence: "required", readonly,
  }]);
  const template = carrier({ kind: "placeholder" });
  const owned = carrier({ kind: "static" });
  const borrowed = carrier({ kind: "parameter", identity: "input", name: "input" });
  const plan = createRustStructuralShapePlan([template, owned, borrowed].map(carrier => ({ carrier })), [],
    () => "source", [], [ { template, instance: owned }, { template, instance: borrowed } ],
    [carrier({ kind: "static" }, floating), carrier({ kind: "static" }, integer, true)].map(carrier => ({ carrier, required: false })));
  assert.equal(plan.definitions.length, 1);
  assert.deepEqual(plan.definitionForCarrier(owned).genericArguments, [{ kind: "lifetime", lifetime: { kind: "static" } }]);
  assert.deepEqual(plan.definitionForCarrier(borrowed).genericArguments, [{ kind: "lifetime",
    lifetime: { kind: "parameter", identity: "input", name: "input" } }]);
  assert.equal(plan.sharesStorage(owned, borrowed), false);
  assert.equal(plan.definitionForCarrier(carrier({ kind: "static" }, floating)), undefined);
  assert.equal(plan.definitionForCarrier(carrier({ kind: "static" }, integer, true)), undefined);
  assert.ok(Object.isFrozen(plan.definitionForCarrier(owned)));
});

test("physical structural templates unify lifted generic terms while retaining exact logical selections", () => {
  const parameter = name => ({ kind: "type-parameter", identity: name, name });
  const projected = (owner, name) => ({ kind: "associated-type", owner,
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] }, name });
  const shape = (type, file = "/source.ts", properties = {}) => rustStructuralObjectTargetType(file, [
    { sourceName: "value", type, presence: "required", readonly: false, ...properties },
  ]);
  const first = shape(projected(parameter("Owner"), "Output"));
  const second = shape(projected(parameter("Other"), "Output"));
  const differentProjection = shape(projected(parameter("Owner"), "Alternate"));
  const direct = shape(parameter("Value"));
  const distinct = [shape(parameter("Value"), "/external.ts"), shape(parameter("Value"), "/source.ts", { readonly: true }),
    shape({ kind: "source-primitive", name: "int32" }), shape({ kind: "source-primitive", name: "uint32" })];
  const carriers = [first, second, differentProjection, direct, ...distinct];
  for (const values of [carriers, [...carriers].reverse()]) {
    const plan = createRustStructuralShapePlan(values.map(carrier => ({ carrier })), [],
      file => file === "/external.ts" ? "external" : "source", [], [], []);
    assert.equal(plan.definitions.length, 5);
    const selected = carriers.map(carrier => plan.definitionForCarrier(carrier));
    for (const definition of selected.slice(0, 4)) {
      assert.equal(definition.targetName, selected[0].targetName);
      assert.equal(definition.genericArguments.length, 1);
    }
    for (const [index, definition] of selected.entries()) assert.equal(definition.carrier, carriers[index]);
    assert.deepEqual(selected[0].genericArguments, [{ kind: "type", type: projected(parameter("Owner"), "Output") }]);
    assert.deepEqual(selected[2].genericArguments, [{ kind: "type", type: projected(parameter("Owner"), "Alternate") }]);
    assert.equal(plan.sharesStorage(first, second), false);
    assert.equal(plan.sharesStorage(first, differentProjection), false);
    assert.equal(plan.sharesStorage(first, shape(projected(parameter("Owner"), "Output"))), true);
    for (const other of distinct) assert.equal(plan.sharesStorage(first, other), false);
    assert.ok(Object.isFrozen(selected[0]) && Object.isFrozen(selected[0].genericArguments));
  }
});

test("structural templates retain method storage under exact native binder renaming", () => {
  const parameter = name => ({ kind: "type-parameter", identity: name, name });
  const origin = { fileName: "/source.ts", declarationIdentity: "identity" };
  const method = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), origin);
  const carrier = (owner, selectedMethod = method, readonly = false, file = "/source.ts") => rustStructuralObjectTargetType(file, [
    { sourceName: "owner", type: owner, presence: "required", readonly },
    { sourceName: "identity", type: selectedMethod, presence: "required", readonly: false, method: true },
  ]);
  const template = carrier(parameter("Owner"));
  const renamed = carrier(parameter("Environment"));
  const differentMethod = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), { ...origin, declarationIdentity: "different" });
  const wrongCarriers = [carrier(parameter("Environment"), differentMethod), carrier(parameter("Environment"), method, true),
    carrier(parameter("Environment"), method, false, "/external.ts")];
  const plan = createRustStructuralShapePlan([{ carrier: template }], [], file => file === "/external.ts" ? "external" : "source", [], [],
    [renamed, ...wrongCarriers].map(carrier => ({ carrier, required: false })));
  const definition = plan.definitionForCarrier(renamed);
  assert.ok(definition);
  assert.equal(definition.targetName, plan.definitionForCarrier(template).targetName);
  assert.deepEqual(definition.genericArguments, [{ kind: "type", type: parameter("Environment") }]);
  const methodIndex = definition.fields.findIndex(field => field.sourceName === "identity");
  assert.ok(methodIndex >= 0);
  const storage = plan.field(renamed, methodIndex).methodStorageCarrier;
  assert.deepEqual(rustGenericCallableValue(storage).signature, rustGenericCallableValue(plan.field(template, methodIndex).methodStorageCarrier).signature);
  assert.deepEqual(rustGenericCallableValue(storage).environment, [parameter("Environment")]);
  assert.deepEqual(rustGenericCallableProtocol(storage, [parameter("Selected")]), { parameters: [renamed, parameter("Selected")], result: parameter("Selected") });
  assert.ok(Object.isFrozen(definition) && Object.isFrozen(plan.field(renamed, methodIndex)));
  for (const wrong of wrongCarriers) assert.equal(plan.definitionForCarrier(wrong), undefined);
  assert.equal(plan.field(renamed, -1), undefined);
});

test("structural instantiation diamonds require one ultimate template in either insertion order", () => {
  const carrier = type => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "value", type, presence: "required", readonly: false,
  }]);
  const template = carrier({ kind: "type-parameter", identity: "Value", name: "Value" });
  const middle = carrier({ kind: "array", element: { kind: "type-parameter", identity: "Element", name: "Element" } });
  const instance = carrier({ kind: "array", element: { kind: "source-primitive", name: "int32" } });
  const shapes = [template, middle, instance].map(carrier => ({ carrier }));
  const edges = [{ template, instance: middle }, { template: middle, instance }, { template, instance }];
  for (const instantiations of [edges, [...edges].reverse()]) {
    const plan = createRustStructuralShapePlan(shapes, [], () => "source", [], instantiations, []);
    assert.equal(plan.definitions.length, 1);
    const definitions = [template, middle, instance].map(carrier => plan.definitionForCarrier(carrier));
    assert.equal(definitions[0].targetName, definitions[1].targetName);
    assert.equal(definitions[0].targetName, definitions[2].targetName);
    assert.deepEqual(definitions[2].genericArguments, [{ kind: "type", type: {
      kind: "array", element: { kind: "source-primitive", name: "int32" },
    } }]);
    assert.equal(plan.sharesStorage(template, instance), false);
    assert.equal(plan.sharesStorage(middle, instance), false);
    assert.equal(plan.sharesStorage(instance, carrier({ kind: "array", element: { kind: "source-primitive", name: "int32" } })), true);
  }
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "source", [], edges.slice(1), []),
    /contradictory storage templates/u);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "source", [], [
    ...edges, { template: instance, instance: template },
  ], []), /cyclic storage templates/u);
});

const requestParameter = name => ({ kind: "type-parameter", identity: name, name });
const requestShape = (type, readonly = false, sourceName = "value") => rustStructuralObjectTargetType("/source.ts", [
  { sourceName, type, presence: "required", readonly },
]);
const requestTemplate = requestShape(requestParameter("Value"));
const analyzeShapes = analyze => {
  try {
    return runTargetCompilationStages({ analyze: () => resolvedTargetStage(analyze()), plan: () => resolvedTargetStage({}),
      materialize: () => ({ artifacts: [] }) });
  } catch {
    return undefined;
  }
};
const assertAnalysisInvariant = (compiled, message) => {
  assert.equal(compiled !== undefined, true, "the failure is classified by the shared analysis boundary");
  assert.equal(compiled.kind, "rejected");
  assert.equal(compiled.diagnostics.length, 1);
  const [diagnostic] = compiled.diagnostics;
  assert.equal(diagnostic.code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT");
  assert.equal(diagnostic.source, "tsonic-rust");
  assert.equal(diagnostic.message, message);
  assert.equal(Object.isFrozen(diagnostic), true, "the diagnostic is frozen");
};

test("published structural reads are pure lookups and an undemanded template-compatible instance stays absent", () => {
  const undemanded = requestShape(requestParameter("Other"));
  const plan = createRustStructuralShapePlan([{ carrier: requestTemplate }], [], () => "source", [], [], []);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(plan.definitionForCarrier(undemanded) === undefined, true, "an undemanded instance is an optional miss");
    assert.equal(plan.field(undemanded, 0) === undefined, true, "an undemanded field read is an optional miss");
    assert.equal(plan.sharesStorage(requestTemplate, undemanded), false, "storage correspondence needs both published definitions");
  }
  const canonical = plan.definitionForCarrier(requestTemplate);
  assert.equal(canonical !== undefined && canonical === plan.definitionForCarrier(requestTemplate), true,
    "a published definition keeps its identity");
  assert.equal(plan.definitions.length, 1);
  assert.equal(Object.isFrozen(plan) && Object.isFrozen(plan.definitions) && Object.isFrozen(canonical), true, "the published plan is frozen");
  assert.equal(Object.hasOwn(plan, "fieldName"), false, "field names are read through the published field data");
  assert.equal(plan.field(requestTemplate, 0).targetName, canonical.fields[0].targetName);
});

test("requested structural instances complete once before publication with exact full metadata", () => {
  const first = requestShape(requestParameter("First"));
  const second = requestShape(requestParameter("Second"));
  const immutable = requestShape(requestParameter("First"), true);
  const plan = createRustStructuralShapePlan([{ carrier: requestTemplate }], [], () => "source", [], [],
    [first, second, immutable].map(carrier => ({ carrier, required: false })));
  const firstDefinition = plan.definitionForCarrier(first);
  const secondDefinition = plan.definitionForCarrier(second);
  assert.equal(firstDefinition !== undefined && secondDefinition !== undefined, true, "each requested instance is published");
  assert.equal(firstDefinition === plan.definitionForCarrier(first), true, "repeated reads return the published object");
  assert.equal(firstDefinition !== secondDefinition && firstDefinition.targetName === secondDefinition.targetName &&
    firstDefinition.componentId === secondDefinition.componentId, true, "distinct full metadata keeps distinct definitions over one template");
  assert.equal(plan.sharesStorage(first, second), false, "different binders do not share storage");
  assert.equal(plan.sharesStorage(first, requestShape(requestParameter("First"))), true, "an equal request shares its published storage");
  assert.equal(plan.definitionForCarrier(immutable) === undefined, true, "a request without an exact storage template stays absent");
  assert.equal(plan.definitions.length, 1, "completing requests adds lookups, not emitted definitions");
  assert.equal(Object.isFrozen(firstDefinition) && Object.isFrozen(firstDefinition.fields) &&
    Object.isFrozen(firstDefinition.genericArguments), true, "a completed definition is frozen");
  assert.deepEqual(firstDefinition.genericArguments, [{ kind: "type", type: requestParameter("First") }]);
});

test("a request context applies once and completes only the finite components of its requests", () => {
  const element = requestParameter("Element");
  const once = { kind: "array", element };
  const twice = { kind: "array", element: once };
  const context = { types: new Map([["Element", once]]), lifetimes: new Map() };
  const value = requestParameter("Value");
  const templates = [requestTemplate, requestShape({ kind: "array", element: value }),
    requestShape({ kind: "array", element: { kind: "array", element: value } })].map(carrier => ({ carrier }));
  const plan = createRustStructuralShapePlan(templates, [], () => "source", [], [],
    [{ carrier: { kind: "array", element: requestShape(element) }, context, required: false }]);
  assert.equal(plan.definitions.length, 3);
  assert.equal(plan.definitionForCarrier(requestShape(element)) !== undefined, true, "the original request component completes");
  assert.equal(plan.definitionForCarrier(requestShape(once)) !== undefined, true, "the context-applied component completes");
  assert.equal(plan.definitionForCarrier(requestShape(twice)) === undefined, true,
    "the context is applied once even though a template for the iterated form exists");
  assert.equal(plan.definitions.length, 3, "completion adds no emitted definition");
});

test("a required request without an exact completion fails at its analysis publisher while an optional one is a miss", () => {
  const unrelated = requestShape(requestParameter("Value"), false, "other");
  assertAnalysisInvariant(analyzeShapes(() => createRustStructuralShapePlan([{ carrier: requestTemplate }], [], () => "source", [], [],
    [{ carrier: unrelated, required: true }])), "A required Rust structural storage request has no exact definition before publication.");
  const optional = createRustStructuralShapePlan([{ carrier: requestTemplate }], [], () => "source", [], [],
    [{ carrier: unrelated, required: false }]);
  assert.equal(optional.definitionForCarrier(unrelated) === undefined, true, "an optional request without a template is an optional miss");
  const required = createRustStructuralShapePlan([{ carrier: requestTemplate }], [], () => "source", [], [],
    [{ carrier: requestShape(requestParameter("Required")), required: true }]);
  assert.equal(required.definitionForCarrier(requestShape(requestParameter("Required"))) !== undefined, true,
    "a required request with an exact template completes");
});

test("the registry answers construction queries while open and publishes one lookup-only plan exactly once", () => {
  const registry = createRustStructuralShapePlanRegistry();
  registry.initialize([{ carrier: requestTemplate }], [], () => "source", [], []);
  registry.initializeUnions([]);
  const open = requestShape(requestParameter("Open"));
  const opened = registry.definitionForCarrier(open);
  assert.equal(opened !== undefined, true, "a construction query completes before publication");
  const published = registry.seal([]);
  assert.equal(published.definitionForCarrier(open) === opened && registry.definitionForCarrier(open) === opened, true,
    "an instance completed while open stays published with its identity");
  const late = requestShape(requestParameter("Late"));
  assert.equal(registry.definitionForCarrier(late) === undefined && published.definitionForCarrier(late) === undefined, true,
    "after publication an undemanded instance is an optional miss through both readers");
  assertAnalysisInvariant(analyzeShapes(() => registry.seal([])), "Rust structural shape plan must be initialized and sealed exactly once.");
  assert.equal(published.definitionForCarrier(late) === undefined, true, "a rejected second seal does not complete instances");
});
