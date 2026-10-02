import assert from "node:assert/strict";
import test from "node:test";
import { createRustGenericCallablePlan } from "../../../dist/analysis/callables/generic-values.js";
import { rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustClosureCaptureFactKey, rustTargetOperationFactKey, rustContextualValueConversionFactKey } from "../../../dist/analysis/facts/keys.js";
import { createRustGenericCallableFlowIndex } from "../../../dist/analysis/callables/generic-callable-flow.js";
import { rustGenericCallableConversionMatches } from "../../../dist/target-model/conversions/generic-callable.js";
import { createRustCallableValuePlanRegistry } from "../../../dist/analysis/callables/value-plan.js";
import { rustObjectLiteralMethodAdapterFactKey } from "../../../dist/analysis/facts/object-methods.js";
import { rustProjectCallableAdaptersKey } from "../../../dist/analysis/facts/project-callable-adapters.js";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { rustReceiverIndependentMethodFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustObjectReferenceViewKey } from "../../../dist/analysis/facts/object-reference-views.js";
import { rustBindingProjectionFactKey } from "../../../dist/analysis/facts/keys.js";

const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
function input() {
  const files = ["first", "second"].map(name => ({ name: `/${name}.ts`, nodes: [] }));
  const closures = files.map((file, index) => {
    const node = { file, position: index + 1 };
    node.carrier = rustGenericCallableTargetType([parameter], [parameter], parameter, {
      fileName: file.name, declarationIdentity: `${file.name}:1`,
    });
    file.nodes.push(node);
    return node;
  });
  const ast = {
    forEachChild: (node, visit) => { for (const child of node.nodes ?? []) visit(child); },
    getSourceFile: node => node.file,
    getFileName: file => file.name,
    pos: node => node.position,
    end: node => node.position + 1,
    as: { AsBinaryExpression: node => node.binary },
  };
  const facts = { getFact: (node, key) => {
    if (key === rustRuntimeCarrierKey && node.carrier !== undefined) return { carrier: node.carrier };
    if (key === rustTargetOperationFactKey && node.operation !== undefined) return node.operation;
    if (key === rustObjectLiteralMethodAdapterFactKey) return node.objectAdapters;
    if (key === rustProjectCallableAdaptersKey) return node.projectAdapters;
    if (key === rustReceiverIndependentMethodFactKey) return node.independent;
    if (key === rustObjectReferenceViewKey) return node.referenceView;
    if (key === rustBindingProjectionFactKey) return node.binding;
    if (key === rustContextualValueConversionFactKey && node.conversion !== undefined) return { conversion: node.conversion };
    if (!closures.includes(node)) return undefined;
    if (key === rustTargetOperationFactKey) return { kind: "closure", resultCarrier: node.carrier };
    if (key === rustClosureCaptureFactKey) return { captures: node.captures ?? [] };
    return undefined;
  } };
  const names = { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined, callableValueNameForDeclaration: () => undefined };
  const navigation = { expressionValueFlow: node => ({ escapes: node === closures[1], identityCompared: false,
    hasUnclassifiedUse: false, captured: false }) };
  return { closures, planInput: { ast, sourceFiles: files, facts, names, navigation,
    lifetimes: { contractFor: () => undefined }, classValueAdapters: [], closedSourceFiles: new Set() },
    create: (closed = new Set()) => createRustGenericCallablePlan(ast, files, facts, names, navigation, [], closed) };
}

test("callable value plans seal only after adapter classification and cannot be replaced", () => {
  const registry = createRustCallableValuePlanRegistry();
  assert.throws(() => registry.generic, /finalized after their selected adapters/u);
  assert.throws(() => registry.suspended, /finalized after their selected adapters/u);
  assert.throws(() => registry.issues, /finalized after their selected adapters/u);
  assert.throws(() => registry.seal(), /finalized after their selected adapters/u);
  const { planInput } = input();
  const plan = registry.initialize(planInput);
  assert.equal(registry.seal(), plan);
  assert.equal(registry.generic, plan.generic);
  assert.equal(registry.suspended, plan.suspended);
  assert.deepEqual(registry.issues, []);
  assert.equal(Object.isFrozen(plan), true);
  assert.throws(() => registry.initialize(planInput), /only once/u);
});

for (const owner of ["class", "object", "project"]) {
  test(`callable ${owner} adapters participate in implementation closure before sealing`, () => {
    const { closures, planInput } = input();
    const adapter = { kind: "option-map", element: { kind: "option-some", element: {
      kind: "conversion", conversion: { kind: "generic-callable-flow", source: closures[0].carrier,
        target: closures[1].carrier },
    } } };
    const dispatch = { resultAdapter: { kind: "identity" }, parameterAdapters: [
      { kind: "rest", segments: [{ kind: "value", adapter }] },
    ] };
    if (owner === "class") planInput.classValueAdapters.push({ subject: closures[0], adapter });
    if (owner === "object") closures[0].objectAdapters = { dispatches: [dispatch] };
    if (owner === "project") closures[0].projectAdapters = [dispatch];
    const plan = createRustCallableValuePlanRegistry().initialize(planInput);
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.generic.definitions.length, 1);
    assert.equal(plan.generic.definitionFor(closures[0].carrier), plan.generic.definitionFor(closures[1].carrier));
    assert.equal(plan.generic.definitions[0].implementations.length, 2);
  });
}

test("unrelated equal-signature implementations do not acquire a common owner or storage policy", () => {
  const { closures, create } = input();
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 2);
  const first = plan.definitionFor(closures[0].carrier);
  const second = plan.definitionFor(closures[1].carrier);
  assert.notEqual(first.identity, second.identity);
  assert.deepEqual(first.implementations.map(value => value.declaration), [closures[0]]);
  assert.deepEqual(second.implementations.map(value => value.declaration), [closures[1]]);
  assert.equal(first.ownerFileName, "/first.ts");
  assert.equal(second.ownerFileName, "/second.ts");
  assert.equal(first.copy, true);
  assert.equal(first.implementations[0].storage, "value");
  assert.equal(second.copy, false);
  assert.equal(second.implementations[0].storage, "shared");
  assert.equal(plan.definitionFor(structuredClone(closures[0].carrier)), first);
});

test("only retained value-flow edges join otherwise independent callable contracts", () => {
  const { closures, create } = input();
  const conversion = { kind: "generic-callable-flow", source: closures[0].carrier, target: closures[1].carrier };
  assert.equal(rustGenericCallableConversionMatches(conversion, conversion.source, conversion.target), true);
  closures[0].conversion = conversion;
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitionFor(conversion.source), plan.definitionFor(conversion.target));
  assert.equal(plan.definitions[0].implementations.length, 2);
});

test("closed returned Copy environments stay inline unless selected operations observe their identity", () => {
  const { closures, planInput, create } = input();
  const closed = new Set(planInput.sourceFiles);
  assert.equal(create(closed).definitionFor(closures[1].carrier).copy, true);
  const comparison = { operation: { kind: "operator-token", operator: "==" },
    binary: { Left: { carrier: closures[1].carrier }, Right: { carrier: closures[1].carrier } } };
  planInput.sourceFiles[0].nodes.push(comparison);
  assert.equal(create(closed).definitionFor(closures[1].carrier).copy, false);
  assert.equal(create(closed).definitionFor(closures[0].carrier).copy, true);
});

test("provider transport and open exports cannot silently lose callable identity", () => {
  const { closures, planInput, create } = input();
  assert.equal(create().definitionFor(closures[1].carrier).copy, false);
  planInput.sourceFiles[0].nodes.push({ operation: { kind: "runtime-call", abi: {
    sourceArguments: [{ disposition: "runtime", carrier: closures[1].carrier }],
  } } });
  assert.equal(create(new Set(planInput.sourceFiles)).definitionFor(closures[1].carrier).copy, false);
  assert.equal(create(new Set(planInput.sourceFiles)).definitionFor(closures[0].carrier).copy, true);
});

test("generic callable flow closure is deterministic, transitive and fail-closed", () => {
  const { closures } = input();
  const first = closures[0].carrier;
  const second = closures[1].carrier;
  const third = rustGenericCallableTargetType([parameter], [parameter], parameter, { fileName: "/third.ts", declarationIdentity: "/third.ts:1" });
  const flow = (source, target) => ({ subject: closures[0], conversion: { kind: "generic-callable-flow", source, target } });
  const edges = [flow(first, second), flow(second, third), flow(third, first)];
  const forward = createRustGenericCallableFlowIndex(edges);
  const reverse = createRustGenericCallableFlowIndex([...edges].reverse());
  assert.deepEqual(forward.issues, []);
  for (const carrier of [first, second, third]) {
    assert.equal(forward.familyFor(carrier), forward.familyFor(first));
    assert.equal(reverse.familyFor(carrier), forward.familyFor(first));
  }
  const invalid = rustGenericCallableTargetType([parameter], [parameter], { kind: "source-primitive", name: "float64" }, first.value.origin);
  const rejected = createRustGenericCallableFlowIndex([flow(invalid, second)]);
  assert.equal(rejected.issues.length, 1);
  assert.notEqual(rejected.familyFor(first), rejected.familyFor(second));
  assert.equal(rustGenericCallableConversionMatches(edges[0].conversion, first, third), false);
});

test("implementations selected for one exact contextual contract share its native representation", () => {
  const { closures, create } = input();
  closures[1].carrier = closures[0].carrier;
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitions[0].implementations.length, 2);
  assert.equal(plan.definitions[0].copy, false);
  assert.equal(plan.definitions[0].identityObserved, true);
  assert.deepEqual(plan.definitions[0].implementations.map(value => value.storage), ["shared", "shared"]);
});

test("a non-Copy environment does not heap-allocate independent Copy variants", () => {
  const { closures, planInput, create } = input();
  closures[1].carrier = closures[0].carrier;
  closures[1].captures = [{ storage: "location", carrier: { kind: "source-primitive", name: "float64" } }];
  const plan = create(new Set(planInput.sourceFiles));
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions[0].copy, false);
  assert.equal(plan.definitions[0].identityObserved, false);
  assert.deepEqual(plan.definitions[0].implementations.map(value => value.storage), ["value", "shared"]);
  assert.equal(plan.implementationFor(closures[0]), plan.definitions[0].implementations[0]);
  const comparison = { operation: { kind: "operator-token", operator: "==" },
    binary: { Left: { carrier: closures[0].carrier }, Right: { carrier: closures[1].carrier } } };
  planInput.sourceFiles[0].nodes.push(comparison);
  const observed = create(new Set(planInput.sourceFiles));
  assert.equal(observed.definitions[0].identityObserved, true);
  assert.deepEqual(observed.definitions[0].implementations.map(value => value.storage), ["shared", "shared"]);
});

test("contradictory signatures under one origin fail closed instead of selecting another family", () => {
  const { closures, create } = input();
  closures[1].carrier = rustGenericCallableTargetType([parameter], [parameter], { kind: "source-primitive", name: "float64" }, closures[0].carrier.value.origin);
  const plan = create();
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0].message, /conflicting native signatures/u);
  assert.equal(plan.definitionFor(closures[1].carrier), undefined);
});

test("receiver-independent methods retain their proven physical ABI without mutating source evidence", () => {
  const { closures, create } = input();
  const physical = closures[0].carrier;
  closures[0].carrier = rustGenericCallableTargetType([parameter], [{ kind: "source-primitive", name: "float64" }, parameter], parameter, physical.value.origin);
  closures[0].independent = { carrier: physical };
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.implementationFor(closures[0]).carrier, physical);
  assert.equal(plan.definitionFor(physical).signature.parameters.length, 1);
  assert.equal(plan.definitionFor(closures[0].carrier), undefined);
  assert.equal(closures[0].carrier.value.signature.parameters.length, 2);
});

test("an escaping receiver-independent method retains its own native identity family", () => {
  const { closures, create } = input();
  const physical = closures[1].carrier;
  closures[1].carrier = rustGenericCallableTargetType([parameter], [{ kind: "source-primitive", name: "float64" }, parameter], parameter, physical.value.origin);
  closures[1].independent = { carrier: physical };
  const plan = create();
  assert.deepEqual(plan.issues, []);
  const definition = plan.definitionFor(physical);
  assert.equal(definition.identityObserved, true);
  assert.equal(definition.copy, false);
  assert.equal(definition.implementations[0].storage, "shared");
});

for (const transport of ["spread", "reference", "rest"]) {
  for (const incompatible of [false, true]) {
    test(`generic field ${transport} transport ${incompatible ? "rejects contradictory contracts" : "retains exact implementation families"}`, () => {
      const { closures, planInput } = input();
      const source = closures[0].carrier;
      const target = incompatible ? rustGenericCallableTargetType([parameter], [parameter], { kind: "source-primitive", name: "float64" }, closures[1].carrier.value.origin) : closures[1].carrier;
      const shape = carrier => rustStructuralObjectTargetType("/first.ts", [{
        sourceName: "identity", type: carrier, presence: "required", readonly: false, method: true,
      }]);
      const node = {};
      if (transport === "spread") node.operation = { kind: "record-literal",
        contributions: [{ kind: "spread", sourceCarrier: shape(source), fields: [{ sourceStorageIndex: 0, targetStorageIndex: 0 }] }],
        fields: [{ storageIndex: 0, carrier: target }],
      };
      if (transport === "reference") node.referenceView = { kind: "structural", sourceCarrier: shape(source), targetCarrier: shape(target),
        fields: [{ destinationIndex: 0, source: { storageIndex: 0, resultCarrier: source } }],
      };
      if (transport === "rest") node.binding = { sourceCarrier: shape(source), bindingCarrier: shape(target),
        projection: { kind: "object-rest", fields: [{ sourceStorageIndex: 0, targetStorageIndex: 0 }] },
      };
      planInput.sourceFiles[0].nodes.push(node);
      const plan = createRustCallableValuePlanRegistry().initialize(planInput);
      assert.equal(plan.issues.length, incompatible ? 1 : 0);
      assert.equal(plan.generic.definitions.length, incompatible ? 2 : 1);
      if (incompatible) assert.match(plan.issues[0].message, /contradictory selected native signatures/u);
      else assert.equal(plan.generic.definitionFor(source), plan.generic.definitionFor(target));
    });
  }
}
