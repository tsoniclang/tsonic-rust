import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { compileRustTarget } from "../../../dist/backend/compile.js";
import { prepareRustGenericCallableDispatchRequests } from "../../../dist/analysis/callables/generic-dispatch.js";
import { createRustGenericCallablePlan } from "../../../dist/analysis/callables/generic-values.js";
import { createRustNativeCallableInputPlan } from "../../../dist/analysis/callables/native-inputs.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustNativeStorageQueries } from "../../../dist/analysis/callables/native-storage.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native-captures.js";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { genericObjectMethodStorageSource } from "../../../../tsonic/test/fixtures/generic-object-methods.mjs";

const joinedLibrary = `
  type Identity = <Value>(value: Value) => Value;
  function make(callback: () => number): Identity {
    const original = <Value>(value: Value): Value => { callback(); return value; };
    const alias: Identity = original;
    return alias;
  }
  export function choose(left: () => number, right: () => number, select: boolean): Identity {
    return select ? make(left) : make(right);
  }
`;

const joinedBinary = `
  type Identity = <Value>(value: Value) => Value;
  function make(callback: () => number): Identity {
    return <Value>(value: Value): Value => { callback(); return value; };
  }
  function choose(left: () => number, right: () => number, select: boolean): Identity {
    return select ? make(left) : make(right);
  }
  export function main(): void {
    const left = () => 1;
    const right = () => 2;
    const first = choose(left, right, true);
    const second = choose(left, right, false);
    if (first<number>(7) !== 7 || second<string>("exact") !== "exact") throw new Error("join");
  }
  main();
`;

function compileObserved(options) {
  let analyzed;
  let inventory;
  const { result } = compileRust({ ...options, compileTarget(request, observer) {
    return compileRustTarget(request, {
      analyzed(program) {
        analyzed = program;
        inventory = program.callableValues.generic.physical.definitions();
        observer.analyzed(program);
      },
      planned: plan => observer.planned(plan),
    });
  } });
  return { result, analyzed, inventory };
}

function construction(text) {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, program.sourceFiles);
  const registry = createRustGenericCallablePlan(source.ast, program.sourceFiles, program.records, program.names, source.navigation);
  let physical;
  const input = { ast: source.ast, storage, records: program.records, definitions: program.typeDefinitions,
    structuralShapes: program.structuralShapes, generic: registry.plan, lexicalFunctions: program.lexicalFunctions,
    lifetimes: program.sourceLifetimes,
    physicalCarrierFor: (carrier, ownerFileName, producers) => physical.carrierFor(carrier, ownerFileName, producers) };
  const native = createRustNativeCallableInputPlan({ ...input, sourcePackages: program.host.sourcePackages, usedNames: new Set() });
  const producers = createRustNativeCallableProducerPlan({ ...input, native, nodes: storage.nodes,
    returnCarrierFor: declaration => {
      const selected = queries.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  const queries = createRustNativeStorageQueries({ ...input, native, producers });
  const captures = createRustNativeCapturePlan({ ...input, nativeStorage: queries });
  physical = registry.initializePhysical({ ...input, native, captures,
    boundSubjectFor: (subject, carrier, bindings) => queries.boundSubjectFor(subject, carrier, bindings) });
  const declaration = name => storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  return { physical, queries, declaration };
}

const factorySource = `
  export function make(callback: () => number): <Value>(value: Value) => Value {
    return <Value>(value: Value): Value => { callback(); return value; };
  }
`;

test("the physical family inventory closes before retained inventories and backend planning cannot extend it", () => {
  const current = compileObserved({ surfaces: [], target: { id: "rust", options: { outputType: "bin", crateName: "physical_closure" } },
    files: { "index.ts": joinedBinary } });
  assert.deepEqual(current.result.diagnostics.map(diagnostic => diagnostic.code), []);
  assert.equal(current.result.artifacts.some(artifact => artifact.path.endsWith(".rs")), true);
  const { generic, nativeGenericProducers, genericDispatch } = current.analyzed.callableValues;
  assert.equal(Object.isFrozen(current.inventory), true);
  assert.equal(generic.physical.definitions() === current.inventory, true,
    "backend planning reads the one frozen inventory and admits no family");
  assert.equal(current.inventory.some(definition => definition.members.length === 2), true,
    "the joined family is admitted before closure");
  for (const binding of nativeGenericProducers.bindings) assert.equal(current.inventory.includes(binding.definition), true);
  assert.equal(current.inventory.some(definition => genericDispatch.requiredFor(definition)), true);
});

test("a family first requested by dispatch is in the inventory read by retained producers and dispatch", () => {
  let context;
  compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "lib", crateName: "retained_closure" } },
    files: { "index.ts": genericObjectMethodStorageSource }, compileTarget(request) {
      context = analyzeRustCheckedContext(request);
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
    } });
  const { generic, nativeStorage, nativeGenericProducers, genericDispatch } = context.callableValues.selected;
  const inventory = generic.physical.definitions();
  assert.equal(Object.isFrozen(inventory) && generic.physical.definitions() === inventory, true);
  const invoked = prepareRustGenericCallableDispatchRequests({ ast: context.ast, records: context.records, generic, nativeStorage,
    structuralShapes: context.structuralShapes, nodes: context.sourceStorage.nodes });
  assert.equal(invoked.length > 0, true, "the source calls select exact physical callee families");
  for (const definition of invoked) {
    assert.equal(inventory.includes(definition), true, `${definition.targetName} was admitted before the inventory closed`);
    assert.equal(genericDispatch.requiredFor(definition), true);
  }
  for (const binding of nativeGenericProducers.bindings) assert.equal(inventory.includes(binding.definition), true);
  assert.equal(generic.physical.definitions() === inventory, true, "re-reading dispatch storage after closure admits nothing");
});

test("published physical reads link exact late keys and never admit an unrooted shape", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const physical = program.callableValues.generic.physical;
  const inventory = physical.definitions();
  const joined = inventory.find(definition => definition.members.length === 2);
  assert.equal(joined !== undefined, true);
  assert.equal(physical.definitionFor(joined.carrier) === joined, true, "the canonical self-carrier links to its own family");
  assert.deepEqual(physical.argumentsFor(joined.carrier), joined.parameters);
  assert.equal(physical.conversionFor(joined.carrier, joined.carrier)?.kind, "identity");
  const value = rustGenericCallableValue(joined.carrier);
  const reordered = rustGenericCallableCarrier({ ...value, physical: { ...value.physical, members: [...value.physical.members].reverse() } });
  assert.equal(physical.definitionFor(reordered) === undefined, true, "a valid unrooted shape stays absent");
  assert.equal(physical.argumentsFor(reordered) === undefined, true);
  assert.equal(physical.conversionFor(reordered, joined.carrier) === undefined, true);
  for (let count = 0; count < 4; count++) assert.equal(physical.definitionFor(joined.carrier) === joined, true);
  assert.equal(physical.definitions() === inventory, true, "repeated and unrooted reads leave the inventory unchanged");
});

test("published callable plans expose no construction capability", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const { generic, nativeCaptures } = program.callableValues;
  for (const [owner, names] of [[generic, ["initializePhysical"]], [generic.physical, ["carrierFor", "closeAdmission", "publish"]],
    [nativeCaptures, ["require", "complete"]], [program.callableValues, ["finalizeSelected", "initialize", "seal"]]]) {
    assert.equal(Object.isFrozen(owner), true);
    for (const name of names) assert.equal(name in owner, false, name);
  }
});

test("published capture environments are the completed required declarations only", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const source = program.source;
  const { generic, nativeCaptures } = program.callableValues;
  const implementations = generic.definitions.flatMap(definition => definition.implementations);
  assert.equal(implementations.length > 0, true);
  for (const implementation of implementations) {
    const selected = nativeCaptures.forDeclaration(implementation.declaration);
    assert.equal(selected.kind, "resolved", selected.reason);
    assert.equal(nativeCaptures.forDeclaration(implementation.declaration) === selected, true);
  }
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const make = nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === "make");
  assert.match(nativeCaptures.forDeclaration(make).reason, /required generic or suspended declarations/u);
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("not owned"); } });
  assert.match(nativeCaptures.forDeclaration(foreign).reason, /owned source declaration/u);
  assert.equal(inspected, 0);
});

test("a family requested after admission closes fails as an internal invariant of its phase", () => {
  const current = construction(factorySource);
  assert.throws(() => current.physical.plan.definitions(), /read only after their admission closes/u);
  current.physical.closeAdmission();
  const inventory = current.physical.plan.definitions();
  assert.equal(Object.isFrozen(inventory), true);
  const make = current.declaration("make");
  assert.throws(() => current.queries.returnFor(make), failure =>
    failure.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" && /admission closed/u.test(failure.message));
  assert.equal(current.physical.plan.definitions() === inventory, true);
  current.physical.publish();
  assert.throws(() => current.queries.returnFor(make), failure => failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.throws(() => current.physical.closeAdmission(), /exactly once/u);
});

test("families admitted before closure remain linkable after closure without new definitions", () => {
  const current = construction(factorySource);
  const make = current.declaration("make");
  const selected = current.queries.returnFor(make);
  assert.equal(selected.kind, "selected", selected.reason);
  current.physical.closeAdmission();
  const inventory = current.physical.plan.definitions();
  assert.equal(inventory.length, 1);
  const again = current.queries.returnFor(make);
  assert.equal(again.kind, "selected", again.reason);
  assert.equal(current.physical.plan.definitionFor(again.carrier) === inventory[0], true);
  assert.equal(current.physical.plan.definitions() === inventory, true);
});

function captureFixture(subjectFor) {
  const declaration = { label: "declaration" };
  const required = { label: "required" };
  const unrequired = { label: "unrequired" };
  const reference = { label: "reference" };
  const carrier = Object.freeze({ kind: "source-primitive", name: "float64" });
  const fact = Object.freeze({ captures: [{ reference, carrier }], receiverFields: [], receivers: [] });
  const facts = new Map([[declaration, fact], [required, fact], [unrequired, fact]]);
  const state = { selections: 0, plan: undefined };
  state.plan = createRustNativeCapturePlan({
    records: createRustRecordFixture({ closureCapture: { get: node => facts.get(node) } }),
    storage: { nodes: [declaration, required, unrequired, reference],
      subjectFor: node => ({ kind: "resolved", subject: { node, kind: "value", projection: [] } }) },
    nativeStorage: { subjectFor(subject, selected, owner) {
      state.selections += 1;
      return subjectFor(state, owner, selected, { declaration, required });
    } },
  });
  return { ...state, state, declaration, required, unrequired, carrier };
}

test("an early missing capture dependency is retried, while a required completion is final", () => {
  let ready = false;
  const current = captureFixture((state, owner, carrier) => ready ? { kind: "identity", carrier }
    : { kind: "unresolved", reason: "pending effect evidence" });
  const { plan, state } = current;
  assert.equal(plan.forDeclaration(current.declaration).reason, "pending effect evidence");
  assert.equal(plan.forDeclaration(current.declaration).reason, "pending effect evidence");
  assert.equal(state.selections, 2, "an open construction failure is not retained as a completed negative");
  const refusal = plan.require(current.required);
  assert.equal(refusal.reason, "pending effect evidence");
  ready = true;
  assert.equal(plan.forDeclaration(current.required) === refusal, true, "the required completion is the final refusal");
  assert.equal(state.selections, 3);
  const resolved = plan.forDeclaration(current.declaration);
  assert.equal(resolved.kind, "resolved");
  assert.equal(plan.forDeclaration(current.declaration) === resolved, true);
  assert.equal(state.selections, 4, "a completed success is retained once");
  const published = plan.complete();
  assert.equal(Object.isFrozen(published) && published !== plan, true);
  assert.equal(published.forDeclaration(current.declaration) === resolved, true);
  assert.equal(published.forDeclaration(current.required) === refusal, true);
  assert.match(published.forDeclaration(current.unrequired).reason, /required generic or suspended declarations/u);
  assert.match(plan.forDeclaration(current.unrequired).reason, /required generic or suspended declarations/u);
  assert.equal(state.selections, 4, "publication performs no capture selection");
  assert.throws(() => plan.complete(), /exactly once/u);
});

test("a re-entrant capture read is not a completed refusal of its outer owner", () => {
  const inner = [];
  const current = captureFixture((state, owner, carrier, { declaration }) => {
    if (owner === declaration) inner.push(state.plan.forDeclaration(declaration));
    return { kind: "identity", carrier };
  });
  const selected = current.plan.forDeclaration(current.declaration);
  assert.equal(selected.kind, "resolved");
  assert.equal(inner.length, 1);
  assert.match(inner[0].reason, /own unfinished capture selection/u);
  assert.equal(current.plan.forDeclaration(current.declaration) === selected, true);
  assert.equal(current.state.selections, 1);
});
