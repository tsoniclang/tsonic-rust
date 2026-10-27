import assert from "node:assert/strict";
import test from "node:test";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import * as structuralShapePlan from "../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import { createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/shapes/structural-shape-registry.js";
import { rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/index.js";
import { rustStructuralGenericCarrier } from "../../../dist/policy/types/objects/structural-generics.js";
import { structuralStorageKey } from "../../../dist/policy/types/objects/structural-storage.js";
import { rustGenericCallableTargetType, rustGenericCallableProtocol, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustRuntimeCallableTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
const noCallablePropertyError = () => assert.fail("this fixture has no fixed callable property requiring a component error");

test("structural registry lifecycle has one owning module without a plan re-export", () => {
  assert.equal(typeof createRustStructuralShapePlanRegistry, "function", "the lifecycle owner exports its actual registry constructor");
  assert.equal("createRustStructuralShapePlanRegistry" in structuralShapePlan, false,
    "the construction owner does not retain the removed registry API as a forwarding path");
  assert.equal(typeof structuralShapePlan.createRustStructuralShapeConstruction, "function",
    "the lifecycle invokes the original structural construction owner directly");
});

function storedMethodExposures(carriers, componentForFile) {
  return new Map(carriers.flatMap(carrier => rustStructuralObjectCarrierValue(carrier).fields.flatMap((field, index) =>
    field.method !== true ? [] : [[`${structuralStorageKey(rustStructuralGenericCarrier(carrier, "fields").carrier, componentForFile)}#${index}`,
      Object.freeze({ kind: "stored" })]])));
}

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
  const plan = createRustStructuralShapePlan(shapes, [], file => file === "/external.ts" ? "dependency" : "app", [], new Map());
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
    () => "source", [], new Map(), [ { template, instance: owned }, { template, instance: borrowed } ]);
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
      file => file === "/external.ts" ? "external" : "source", [], new Map());
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
  const plan = createRustStructuralShapePlan([{ carrier: template }], [], file => file === "/external.ts" ? "external" : "source", [],
    storedMethodExposures([template], file => file === "/external.ts" ? "external" : "source"));
  const renamed = carrier(parameter("Environment"));
  const definition = plan.definitionForCarrier(renamed);
  assert.ok(definition);
  assert.equal(definition.targetName, plan.definitionForCarrier(template).targetName);
  assert.deepEqual(definition.genericArguments, [{ kind: "type", type: parameter("Environment") }]);
  const methodIndex = definition.fields.findIndex(field => field.sourceName === "identity");
  assert.ok(methodIndex >= 0);
  const storage = plan.field(renamed, methodIndex).methodPlan.carrier;
  assert.deepEqual(rustGenericCallableValue(storage).signature, rustGenericCallableValue(plan.field(template, methodIndex).methodPlan.carrier).signature);
  assert.deepEqual(rustGenericCallableValue(storage).environment, [parameter("Environment")]);
  assert.deepEqual(rustGenericCallableProtocol(storage, [parameter("Selected")]), { parameters: [renamed, parameter("Selected")], result: parameter("Selected") });
  assert.ok(Object.isFrozen(definition) && Object.isFrozen(plan.field(renamed, methodIndex)));
  const differentMethod = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), { ...origin, declarationIdentity: "different" });
  for (const wrong of [carrier(parameter("Environment"), differentMethod), carrier(parameter("Environment"), method, true),
    carrier(parameter("Environment"), method, false, "/external.ts")]) assert.equal(plan.definitionForCarrier(wrong), undefined);
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
    const plan = createRustStructuralShapePlan(shapes, [], () => "source", [], new Map(), instantiations);
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
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "source", [], new Map(), edges.slice(1)),
    /contradictory storage templates/u);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "source", [], new Map(), [
    ...edges, { template: instance, instance: template },
  ]), /cyclic storage templates/u);
});

test("physical method installation completes canonical and already indexed borrowed instances once", () => {
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  const integer = { kind: "source-primitive", name: "int32" };
  const borrowedLifetime = { kind: "parameter", identity: "borrowed", name: "borrowed" };
  const carrier = (value, lifetime) => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "read", type: rustCallableTargetType([], value, lifetime), presence: "required", readonly: false, method: true,
  }]);
  const template = carrier(parameter, { kind: "placeholder" });
  const owned = carrier(integer, { kind: "static" });
  const borrowed = carrier(parameter, borrowedLifetime);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([template, owned, borrowed].map(carrier => ({ carrier })), [], () => "source", [], [
    { template, instance: owned }, { template, instance: borrowed },
  ], storedMethodExposures([template, owned, borrowed], () => "source"));
  builder.initializeUnions([]);
  const before = builder.definitionForCarrier(owned);
  const definition = builder.definitions[0];
  const logical = definition.fields[0].carrier;
  const protocol = rustCallableProtocol(definition.fields[0].methodPlan.carrier);
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const object = {};
  const property = {};
  const expression = {};
  const destinationCarrier = rustCallableTargetType(protocol.parameters, protocol.result, protocol.lifetime, infallible);
  const physicalCarrier = rustRuntimeCallableTargetType(protocol.lifetime, protocol.parameters,
    rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: protocol.result }, { kind: "type", type: infallible },
    ]));
  builder.finalizeMethodStorage(new Map([[definition, new Map([[0,
    { carrier: destinationCarrier, nativeBody: undefined, constructions: [{ object, property, expression, storageIndex: 0,
      physicalCarrier, destinationCarrier, payload: { captures: [], receiverFields: [], receivers: [] } }] },
  ]])]]), noCallablePropertyError);
  const after = builder.seal();
  assert.equal(after.definitions[0].fields[0].carrier === logical, true, "logical method contract remains unchanged");
  assert.equal(after.definitionForCarrier(owned) === before, false, "the indexed instance is replaced with the completed definition");
  for (const [source, expectedResult, expectedLifetime] of [
    [owned, integer, { kind: "static" }], [borrowed, parameter, borrowedLifetime],
  ]) {
    const field = after.field(source, 0);
    const selected = rustCallableProtocol(field.methodPlan.carrier);
    assert.deepEqual(selected.result, expectedResult, "the physical result is forward substituted");
    assert.deepEqual(selected.lifetime, expectedLifetime, "the destination lifetime is forward substituted");
    assert.deepEqual(selected.error, infallible, "the completed invocation error is selected before publication");
    assert.equal(Object.isFrozen(field), true, "completed fields are immutable");
    assert.equal(after.field(source, 0) === field, true, "completed indexed lookups have stable identity");
    assert.equal(field.methodPlan.constructions.length, 1, "the exact original contribution has one completed physical witness");
    const construction = field.methodPlan.constructions[0];
    assert.equal(construction.object === object && construction.property === property && construction.expression === expression,
      true, "template instantiation preserves every original construction identity");
    assert.equal(construction.storageIndex, 0, "the original target field index is retained");
    assert.equal(Object.isFrozen(field.methodPlan.constructions) && Object.isFrozen(construction), true,
      "published construction witnesses are immutable");
    assert.equal(rustTargetTypeRefEquals(construction.destinationCarrier, field.methodPlan.carrier), true,
      "the whole witness uses the same finalized destination instance");
    const physical = rustCallablePhysicalSignature(construction.physicalCarrier);
    assert.equal(physical !== undefined, true, "the original physical construction signature remains exact");
    assert.equal(rustTargetTypeRefEquals(physical.result, expectedResult), true,
      "native construction and destination results receive the same actual generic substitution");
    assert.equal(rustTargetTypeRefEquals(physical.error, infallible), true,
      "native construction retains the selected exact error payload");
  }
  assert.throws(() => builder.finalizeMethodStorage(new Map(), noCallablePropertyError), /exactly once/u);
});

test("completed source aliases publish one exact physical structural instance per native carrier", () => {
  const carrier = (file, primitive) => rustStructuralObjectTargetType(file, [{
    sourceName: "count", type: { kind: "source-primitive", name: primitive }, presence: "required", readonly: true,
  }]);
  const original = carrier("/original.ts", "int32");
  const alias = carrier("/alias.ts", "int32");
  const wide = carrier("/wide.ts", "int64");
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([original, alias, wide].map(carrier => ({ carrier })), [], () => "source", [], [], new Map());
  for (const source of [original, alias]) {
    const selected = builder.completePhysicalCarrier(source, original, { kind: "instance" });
    assert.equal(selected.kind, "resolved", "the existing component owner admits the actual complete physical layout");
    assert.equal(selected.carrier === original, true, "source lookup identity is distinct from the single selected native carrier");
  }
  builder.initializeUnions([]);
  builder.finalizeMethodStorage(new Map(), noCallablePropertyError);
  const plan = builder.seal();
  const physical = plan.definitionForCarrier(original);
  assert.equal(physical !== undefined, true, "the actual physical carrier has its canonical published owner");
  assert.equal(plan.definitionForCarrier(alias) === physical, true, "both original lookup keys share that exact completed native instance");
  assert.equal(plan.instances.filter(instance => rustTargetTypeRefEquals(instance.carrier, original)).length, 1,
    "source aliases never become duplicate native shape publications");
  assert.equal(plan.instances.length, 2, "the genuinely different native width retains its independent physical instance");
  assert.equal(plan.definitionForCarrier(wide) !== physical, true, "canonicalization cannot erase native field width or identity");
  assert.equal(Object.isFrozen(plan.instances) && plan.instances.every(Object.isFrozen), true,
    "the final native inventory is immutable and contains only completed physical instances");
});

test("physical method witnesses reject mismatched complete signatures before publishing any field", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const floating = { kind: "source-primitive", name: "float64" };
  const lifetime = { kind: "static" };
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const otherError = { kind: "target-named", id: "source.NativeError" };
  const shape = rustStructuralObjectTargetType("/source.ts", [{ sourceName: "read",
    type: rustCallableTargetType([integer], integer, lifetime), presence: "required", readonly: false, method: true }]);
  const physical = (parameters, result, error) => rustRuntimeCallableTargetType(lifetime, parameters,
    rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: result }, { kind: "type", type: error },
    ]));
  for (const label of ["input", "result", "error", "logical source", "destination", "field index"]) {
    const builder = createRustStructuralShapePlanRegistry();
    builder.initialize([{ carrier: shape }], [], () => "source", [], [], storedMethodExposures([shape], () => "source"));
    builder.initializeUnions([]);
    const definition = builder.definitions[0];
    const original = builder.field(shape, 0);
    const protocol = rustCallableProtocol(original.methodPlan.carrier);
    const destinationCarrier = rustCallableTargetType(protocol.parameters, protocol.result, protocol.lifetime, infallible);
    const witness = { object: {}, property: {}, expression: {}, storageIndex: 0,
      physicalCarrier: physical(protocol.parameters, protocol.result, infallible), destinationCarrier,
      payload: { captures: [], receiverFields: [], receivers: [] } };
    if (label === "input") witness.physicalCarrier = physical([...protocol.parameters, floating], protocol.result, infallible);
    if (label === "result") witness.physicalCarrier = physical(protocol.parameters, floating, infallible);
    if (label === "error") witness.physicalCarrier = physical(protocol.parameters, protocol.result, otherError);
    if (label === "logical source") witness.physicalCarrier = destinationCarrier;
    if (label === "destination") witness.destinationCarrier = rustCallableTargetType(protocol.parameters, floating, lifetime, infallible);
    if (label === "field index") witness.storageIndex = 1;
    const selections = new Map([[definition, new Map([[0, { carrier: destinationCarrier, constructions: [witness], nativeBody: undefined }]])]]);
    assert.throws(() => builder.finalizeMethodStorage(selections, noCallablePropertyError), /Structural method construction requires/u,
      `${label}: a whole invalid witness is rejected at the publishing boundary`);
    assert.equal(builder.field(shape, 0) === original, true,
      `${label}: failed admission publishes no partially replaced field`);
    assert.equal(builder.field(shape, 0).methodPlan.constructions.length, 0,
      `${label}: failed admission publishes no construction evidence`);
  }
});

function checkedStructuralMethods(source, label) {
  let context;
  let sourceTypes;
  compileRust({ surfaces: [], files: { "index.ts": source }, compileTarget(request) {
    context = analyzeRustCheckedContext(request, originalContext => {
      const originalValues = originalContext.callableValues;
      const callableValues = Object.freeze(Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(originalValues),
        initialize: { value(input) {
          sourceTypes = input.sourceTypes;
          return originalValues.initialize(input);
        }, enumerable: true },
      }));
      return Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(originalContext),
        callableValues: { value: callableValues, enumerable: true },
      });
    });
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(context !== undefined, true, `${label}: checked source analysis is reached`);
  assert.equal(context.diagnostics.length, 0, `${label}: ${context.diagnostics.map(issue =>
    `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048)}`);
  assert.equal(sourceTypes !== undefined, true, `${label}: checked physical construction is reached`);
  const { ast, records, sourceStorage: storage, structuralShapes } = context;
  const selected = context.callableValues.selected;
  assert.equal(selected.issues.length, 0, `${label}: ${selected.issues.map(issue => issue.message).join("\n").slice(0, 2048)}`);
  const nodes = new Set(storage.nodes);
  const literals = storage.nodes.flatMap(node => {
    const operation = records.targetOperation.get(node);
    return operation?.kind === "record-literal" && operation.storage === "structural-object" ? [{ node, operation }] : [];
  });
  const originals = literals.flatMap(({ node, operation }) => operation.contributions.flatMap(contribution =>
    contribution.kind === "structural-method" ? [{ object: node, property: contribution.property,
      expression: contribution.expression, storageIndex: contribution.targetStorageIndex }] : []));
  assert.equal(originals.length > 0, true, `${label}: actual original method constructions are present`);
  const witnessedFields = [];
  const transports = [];
  for (const { node, operation } of literals) {
    for (const described of operation.fields.filter(field => field.method === true)) {
      const field = structuralShapes.field(operation.resultCarrier, described.storageIndex);
      assert.equal(field?.method === true && field.methodPlan !== undefined, true,
        `${label}: every method field has one native representation plan`);
      if (field.methodPlan.kind === "fixed") {
        const body = field.methodPlan;
        const original = originals.find(original => original.object === node && original.property === body.declaration &&
          original.expression === body.declaration && original.storageIndex === described.storageIndex);
        assert.equal(original !== undefined && nodes.has(body.declaration) && ast.parent(body.declaration) === node, true,
          `${label}: fixed native body preserves all three original checked construction identities`);
        assert.equal(body.constructions.length, 0, `${label}: a fixed native body fabricates no retained Callable construction`);
        assert.equal(body.payload !== undefined && Object.isFrozen(body.payload), true,
          `${label}: the fixed body publishes its completed immutable native payload`);
        const source = records.closureCapture.get(body.declaration);
        assert.equal(source !== undefined && body.payload.captures.length === source.captures.length &&
          body.payload.receiverFields.length === source.receiverFields.length && body.payload.receivers.length === source.receivers.length, true,
        `${label}: fixed native capture publication preserves the complete checked source domain`);
        assert.equal(body.payload.captures.every((capture, index) => capture.declaration === source.captures[index].declaration &&
          capture.reference === source.captures[index].reference) && body.payload.receivers.every((capture, index) =>
          capture.owner === source.receivers[index].owner && capture.reference === source.receivers[index].reference), true,
        `${label}: fixed capture and receiver identities are the original checked nodes`);
      } else assert.equal(field.methodPlan.constructions.length > 0, true,
        `${label}: every retained method field has completed original construction evidence`);
      const carrier = field.presence === "optional" ? rustOptionElementCarrier(field.methodPlan.carrier) : field.methodPlan.carrier;
      const protocol = rustCallableProtocol(carrier);
      assert.equal(protocol !== undefined, true, `${label}: the final method storage has a native protocol`);
      const logical = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(field.carrier) : field.carrier);
      assert.equal(logical !== undefined && rustTargetTypeRefEquals(protocol.result, logical.result), true,
        `${label}: every actual generic result matches its own checked logical field contract`);
      assert.equal(Object.isFrozen(field) && Object.isFrozen(field.methodPlan.constructions), true,
        `${label}: the final method field and its construction vector are frozen`);
      assert.equal(structuralShapes.field(operation.resultCarrier, described.storageIndex) === field, true,
        `${label}: completed field lookup has stable identity`);
      for (const witness of field.methodPlan.constructions) {
        const original = originals.find(original => original.object === witness.object && original.property === witness.property &&
          original.expression === witness.expression);
        assert.equal(original !== undefined, true, `${label}: witnesses preserve all three original contribution identities`);
        assert.equal(nodes.has(witness.object) && nodes.has(witness.property) && nodes.has(witness.expression), true,
          `${label}: foreign source identities never become construction evidence`);
        const element = storage.source.semantics.forNode(witness.property).operations.objectLiteralElement(witness.property);
        assert.equal(element?.element === witness.property && element.objectLiteral === witness.object &&
          ast.parent(witness.property) === witness.object, true,
          `${label}: the checked original property owns its exact method expression`);
        assert.equal(Object.isFrozen(witness), true, `${label}: every original construction witness is frozen`);
        assert.equal(witness.storageIndex, described.storageIndex, `${label}: construction carries the actual destination index`);
        assert.equal(rustTargetTypeRefEquals(witness.destinationCarrier, carrier), true,
          `${label}: construction and field have the same complete final destination`);
        const physical = rustCallablePhysicalSignature(witness.physicalCarrier);
        assert.equal(physical !== undefined && physical.parameters.length === protocol.parameters.length &&
          physical.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, protocol.parameters[index])) &&
          rustTargetTypeRefEquals(physical.result, protocol.result) && rustTargetTypeRefEquals(physical.error, protocol.error), true,
        `${label}: original native input, result and error match the exact final destination`);
      }
      witnessedFields.push({ node, operation, described, field, protocol });
    }
    for (const contribution of operation.contributions.filter(contribution => contribution.kind === "spread")) {
      const methods = contribution.fields.filter(field => field.method === true);
      if (methods.length === 0) continue;
      const source = storage.subjectFor(contribution.expression);
      assert.equal(source.kind, "resolved", `${label}: spread uses its actual checked storage subject`);
      const typed = storage.typeFor(source.subject);
      assert.equal(typed.kind, "resolved", `${label}: spread has its exact checked source type`);
      const type = storage.source.semantics.forFile(typed.sourceFile).types.nonNullableType(typed.type);
      const sourceShape = sourceTypes.structuralObjectForType(type, contribution.sourceValueCarrier);
      assert.equal(sourceShape !== undefined, true, `${label}: source shape follows the canonical checked type and actual carrier`);
      const owner = sourceEnclosingCallable(node, ast);
      const bindings = owner === undefined ? storage.emptyBindings : selected.native.bindingsFor(owner);
      assert.equal(bindings !== undefined, true, `${label}: the actual lexical activation is retained`);
      for (const transport of methods) {
        const sourceField = sourceShape.fields[transport.sourceStorageIndex];
        assert.equal(sourceField?.method === true && sourceField.storageIndex === transport.sourceStorageIndex &&
          rustTargetTypeRefEquals(sourceField.resultCarrier, transport.carrier), true,
        `${label}: source field and explicit spread correspondence agree exactly`);
        const targetField = structuralShapes.field(operation.resultCarrier, transport.targetStorageIndex);
        assert.equal(targetField?.method === true, true, `${label}: transport selects the actual destination method field`);
        const producerNodes = new Set();
        for (const declaration of sourceField.declarations) {
          const projected = storage.subject(source.subject.node, source.subject.kind,
            [...source.subject.projection, { kind: "method-value", declaration }]);
          assert.equal(projected.kind, "resolved", `${label}: the canonical source method declaration is projected`);
          const producers = storage.storageProducersFor(projected.subject, bindings);
          assert.equal(producers.kind, "complete", `${label}: all actual method producers are admitted`);
          assert.equal(producers.producers.length > 0, true, `${label}: the actual method producer set is nonempty`);
          for (const producer of producers.producers) {
            producerNodes.add(producer.subject.node);
            const creationOwner = sourceEnclosingCallable(ast.parent(producer.subject.node), ast);
            const actual = selected.nativeStorage.genericBindingsFor(creationOwner ?? producer.subject.node, producer.bindings);
            assert.equal(actual.kind, "resolved", `${label}: each producer has its own required actual creation bindings`);
            const witnesses = targetField.methodPlan.constructions.filter(witness => witness.expression === producer.subject.node);
            assert.equal(witnesses.length > 0, true, `${label}: every producer keeps its original expression at the destination`);
            for (const witness of witnesses) {
              assert.equal(witness.object !== node && witness.expression !== contribution.expression &&
                witness.property !== contribution.expression, true, `${label}: no target spread or alias becomes a fabricated closure`);
              assert.equal(witness.storageIndex, transport.targetStorageIndex,
                `${label}: transport uses targetStorageIndex rather than the source index`);
            }
          }
        }
        transports.push({ node, targetCarrier: operation.resultCarrier, contribution, sourceField, transport, targetField, producerNodes });
      }
    }
  }
  return { context, originals, witnessedFields, transports };
}

const methodStorageSources = [
  ["direct", `function make(value: number): { read(): number } { return { read(): number { return value; } }; }
export function run(): number { const original = make(7); return original.read(); }`],
  ["prefix index remap", `function make(value: number): { read(): number } { return { read(): number { return value; } }; }
export function run(): number { const original = make(7); const copied = { aaa: 3, ...original }; return copied.aaa + copied.read(); }`],
  ["different layout without index remap", `function make(value: number): { read(): number } { return { read(): number { return value; } }; }
export function run(): number { const original = make(7); const copied = { ...original, zzz: 3 }; return copied.zzz + copied.read(); }`],
  ["immutable aliases", `function make(value: number): { read(): number } { return { read(): number { return value; } }; }
export function run(): number { const original = make(7); const first = original; const alias = first; const copied = { aaa: 3, ...alias }; return copied.aaa + copied.read(); }`],
  ["repeated spreads", `function make(value: number): { read(): number } { return { read(): number { return value; } }; }
export function run(): number { const original = make(7); const first = { aaa: 3, ...original }; const copied = { bbb: 5, ...first }; return copied.aaa + copied.bbb + copied.read(); }`],
  ["multiple sources", `function makeRead(value: number): { read(): number } { return { read(): number { return value; } }; }
function makeOther(value: number): { other(): number } { return { other(): number { return value; } }; }
export function run(): number { const left = makeRead(7); const right = makeOther(11); const copied = { aaa: 3, ...left, ...right }; return copied.aaa + copied.read() + copied.other(); }`],
  ["two generic bindings", `function make<Value>(value: Value): { read(): Value } { return { read(): Value { return value; } }; }
export function run(): boolean { const numeric = { aaa: 3, ...make(7) }; const textual = { aaa: 3, ...make("value") }; return numeric.read() === 7 && textual.read() === "value"; }`],
  ["nested generic bindings", `function make<Value>(value: Value): { read(): Value } { return { read(): Value { return value; } }; }
function copy<Actual>(value: Actual) { const original = make(value); const alias = original; return { aaa: 3, ...alias }; }
export function run(): number { const nested = { inner: copy(7) }; return nested.inner.aaa + nested.inner.read(); }`],
  ["all same ABI alternatives", `function makeLeft(value: number): { read(): number } { return { read(): number { return value; } }; }
function makeRight(value: number): { read(): number } { return { read(): number { return value; } }; }
export function choose(flag: boolean): number { const original = flag ? makeLeft(7) : makeRight(11); const copied = { aaa: 3, ...original }; return copied.aaa + copied.read(); }
export function run(): boolean { return choose(true) === 10 && choose(false) === 14; }`],
];

for (const [label, source] of methodStorageSources) {
  test(`physical method construction transport preserves every checked source for ${label}`, () => {
    const { originals, transports } = checkedStructuralMethods(source, label);
    assert.equal(originals.length > 0, true, `${label}: original source provenance remains present`);
    if (label === "direct") assert.equal(transports.length, 0, "direct: control has no spread transport");
    else assert.equal(transports.length > 0, true, `${label}: actual checked spreads are exercised`);
    if (label === "prefix index remap") assert.equal(transports.some(({ transport }) =>
      transport.sourceStorageIndex !== transport.targetStorageIndex), true,
    "prefix index remap: the actual source and destination field indices differ");
    if (label === "different layout without index remap") assert.equal(transports.some(({ contribution, transport, targetCarrier }) =>
      transport.sourceStorageIndex === transport.targetStorageIndex &&
      !rustTargetTypeRefEquals(contribution.sourceValueCarrier, targetCarrier)), true,
    "different layout without index remap: transport is not conditional on an index offset");
    if (label === "repeated spreads") assert.equal(transports.length >= 2, true,
      "repeated spreads: every intermediate contribution retains original construction evidence");
    if (label === "multiple sources") {
      const expressions = new Set(transports.flatMap(transport => [...transport.producerNodes]));
      assert.equal(expressions.size, 2, "multiple sources: neither method is replaced by the first producer");
    }
    if (label === "two generic bindings") {
      assert.equal(transports.length, 2, "two generic bindings: both actual destination instances are present");
      const fields = transports.map(({ targetField }) => {
        const carrier = targetField.presence === "optional" ? rustOptionElementCarrier(targetField.methodPlan.carrier)
          : targetField.methodPlan.carrier;
        return rustCallableProtocol(carrier);
      });
      assert.equal(rustTargetTypeRefEquals(fields[0].result, fields[1].result), false,
        "two generic bindings: the same source declaration retains distinct actual native result types");
      assert.equal(transports[0].targetField.methodPlan.constructions.some(left =>
        transports[1].targetField.methodPlan.constructions.some(right => left.expression === right.expression)), true,
      "two generic bindings: the comparison exercises one source method, not unrelated source declarations");
    }
    if (label === "all same ABI alternatives") assert.equal(transports.some(({ producerNodes }) => producerNodes.size === 2), true,
      "all same ABI alternatives: the complete actual producer set is retained despite equal signatures");
  });
}

test("transported physical method witnesses preserve actual borrowed captures without static promotion", () => {
  const label = "borrowed remapped method";
  const { transports } = checkedStructuralMethods(`import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
function make<Region extends Life>(value: Ref<int32, Region>): { read(): int32 } { return { read(): int32 { return load(value); } }; }
export function read<Region extends Life>(value: Ref<int32, Region>): int32 {
  const original = make(value); const copied = { aaa: 3, ...original }; return copied.read();
}`, label);
  assert.equal(transports.length, 1, `${label}: the actual borrowed source has one remapped destination`);
  const field = transports[0].targetField;
  const protocol = rustCallableProtocol(field.methodPlan.carrier);
  assert.equal(protocol.lifetime !== undefined && protocol.lifetime.kind !== "static", true,
    `${label}: the native destination preserves the actual nonstatic captured environment`);
});

test("transported method construction evidence never matches a foreign or missing source identity", () => {
  const source = methodStorageSources.find(([label]) => label === "prefix index remap")[1];
  const local = checkedStructuralMethods(source, "local source");
  const foreign = checkedStructuralMethods(source, "foreign source");
  const field = local.transports[0].targetField;
  for (const original of foreign.originals) {
    assert.equal(field.methodPlan.constructions.some(witness => witness.expression === original.expression ||
      witness.object === original.object || witness.property === original.property), false,
    "foreign source: equal source text and native carrier do not manufacture checked construction identity");
    assert.equal(local.context.callableValues.selected.nativeStorage.genericBindingsFor(original.expression,
      local.context.sourceStorage.emptyBindings).kind, "unresolved",
    "foreign source: an unowned source declaration cannot supply native construction bindings");
  }
  const missing = Object.freeze({});
  assert.equal(field.methodPlan.constructions.some(witness => witness.expression === missing || witness.object === missing ||
    witness.property === missing), false, "missing source: no default construction fills absent checked evidence");
});

test("a remapped physical method rejects its old source index without partially publishing destination fields", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const lifetime = { kind: "static" };
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const shape = rustStructuralObjectTargetType("/destination.ts", [
    { sourceName: "aaa", type: integer, presence: "required", readonly: false },
    { sourceName: "read", type: rustCallableTargetType([], integer, lifetime), presence: "required", readonly: false, method: true },
  ]);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: shape }], [], () => "source", [], [], storedMethodExposures([shape], () => "source"));
  builder.initializeUnions([]);
  const definition = builder.definitions[0];
  const originalFields = definition.fields;
  const protocol = rustCallableProtocol(originalFields[1].methodPlan.carrier);
  const destinationCarrier = rustCallableTargetType(protocol.parameters, protocol.result, protocol.lifetime, infallible);
  const physicalCarrier = rustRuntimeCallableTargetType(lifetime, protocol.parameters,
    rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: protocol.result }, { kind: "type", type: infallible },
    ]));
  const constructions = [{ object: {}, property: {}, expression: {}, storageIndex: 0, physicalCarrier, destinationCarrier,
    payload: { captures: [], receiverFields: [], receivers: [] } }];
  assert.throws(() => builder.finalizeMethodStorage(new Map([[definition, new Map([[1,
    { carrier: destinationCarrier, constructions, nativeBody: undefined },
  ]])]]), noCallablePropertyError), /Structural method construction requires its exact destination field/u);
  for (const [index, field] of originalFields.entries()) {
    assert.equal(builder.field(shape, index) === field, true, `remapped index: destination field ${index} is unchanged`);
    assert.equal(builder.field(shape, index).methodPlan?.constructions.length ?? 0, 0,
      `remapped index: invalid source index publishes no partial construction for field ${index}`);
  }
});
