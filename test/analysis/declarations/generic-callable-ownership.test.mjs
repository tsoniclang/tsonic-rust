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

const parameter = { kind: "type-parameter", name: "Value" };
function input() {
  const files = ["first", "second"].map(name => ({ name: `/${name}.ts`, nodes: [] }));
  const closures = files.map((file, index) => {
    const node = { file, position: index + 1 };
    node.carrier = rustGenericCallableTargetType(["Value"], [parameter], parameter, {
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
  };
  const facts = { getFact: (node, key) => {
    if (key === rustObjectLiteralMethodAdapterFactKey) return node.objectAdapters;
    if (key === rustProjectCallableAdaptersKey) return node.projectAdapters;
    if (key === rustContextualValueConversionFactKey && node.conversion !== undefined) return { conversion: node.conversion };
    if (!closures.includes(node)) return undefined;
    if (key === rustTargetOperationFactKey) return { kind: "closure", resultCarrier: node.carrier };
    if (key === rustClosureCaptureFactKey) return { captures: [] };
    return undefined;
  } };
  const names = { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined, callableValueNameForDeclaration: () => undefined };
  const navigation = { expressionValueFlow: node => ({ escapes: node === closures[1], identityCompared: false,
    hasUnclassifiedUse: false, captured: false }) };
  return { closures, planInput: { ast, sourceFiles: files, facts, names, navigation,
    lifetimes: { contractFor: () => undefined }, classValueAdapters: [] },
    create: () => createRustGenericCallablePlan(ast, files, facts, names, navigation) };
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
      { kind: "fixed-rest", elementAdapters: [adapter] },
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
  assert.equal(first.storage, "value");
  assert.equal(second.storage, "shared");
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

test("generic callable flow closure is deterministic, transitive and fail-closed", () => {
  const { closures } = input();
  const first = closures[0].carrier;
  const second = closures[1].carrier;
  const third = rustGenericCallableTargetType(["Value"], [parameter], parameter, { fileName: "/third.ts", declarationIdentity: "/third.ts:1" });
  const flow = (source, target) => ({ subject: closures[0], conversion: { kind: "generic-callable-flow", source, target } });
  const edges = [flow(first, second), flow(second, third), flow(third, first)];
  const forward = createRustGenericCallableFlowIndex(edges);
  const reverse = createRustGenericCallableFlowIndex([...edges].reverse());
  assert.deepEqual(forward.issues, []);
  for (const carrier of [first, second, third]) {
    assert.equal(forward.familyFor(carrier), forward.familyFor(first));
    assert.equal(reverse.familyFor(carrier), forward.familyFor(first));
  }
  const invalid = rustGenericCallableTargetType(["Value"], [parameter], { kind: "source-primitive", name: "float64" }, first.value.origin);
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
  assert.equal(plan.definitions[0].storage, "shared");
});

test("contradictory signatures under one origin fail closed instead of selecting another family", () => {
  const { closures, create } = input();
  closures[1].carrier = rustGenericCallableTargetType(["Value"], [parameter], { kind: "source-primitive", name: "float64" }, closures[0].carrier.value.origin);
  const plan = create();
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0].message, /conflicting native signatures/u);
  assert.equal(plan.definitionFor(closures[1].carrier), undefined);
});
