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
import { rustTargetTypeChildren } from "../../../dist/target-model/types/carriers/children.js";
import { planRustOutput } from "../../../dist/backend/planner/program/index.js";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import { genericObjectMethodStorageSource } from "../../../../tsonic/test/fixtures/generic-object-methods.mjs";

const identityDeclarations = `
  async function first(value: number): Promise<number> { return value; }
  async function second(value: number): Promise<number> { return value; }
  function selected(): typeof first { return first; }
  export function compare(): boolean {
    const alias = selected();
    return alias === first && alias !== second;
  }
`;

const pendingCapture = Object.freeze({ kind: "unresolved", reason: "pending effect evidence" });

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

function construction(text, wrapCaptures = captures => captures) {
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
  const captures = wrapCaptures(createRustNativeCapturePlan({ ...input, nativeStorage: queries }));
  physical = registry.initializePhysical({ ...input, native, captures,
    boundSubjectFor: (subject, carrier, bindings) => queries.boundSubjectFor(subject, carrier, bindings) });
  const declaration = name => storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  const implementations = registry.plan.definitions.flatMap(definition => definition.implementations);
  return { physical, queries, declaration, implementations, captures };
}

function countedCaptures(state) {
  return captures => Object.freeze({
    forDeclaration(declaration) {
      state.selections += 1;
      state.onSelect?.(declaration);
      return state.ready === false ? pendingCapture : captures.forDeclaration(declaration);
    },
    require(declaration) {
      state.selections += 1;
      return state.ready === false ? pendingCapture : captures.require(declaration);
    },
    complete: () => captures.complete(),
  });
}

function checkedContext(source, target) {
  let context;
  compileRust({ surfaces: [], target, files: { "index.ts": source }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  return context;
}

function familiesOf(physical, carrier) {
  const found = new Set();
  const visited = new Set();
  const visit = current => {
    if (visited.has(current)) return;
    visited.add(current);
    const definition = physical.definitionFor(current);
    if (definition !== undefined) found.add(definition);
    for (const child of rustTargetTypeChildren(current)) visit(child);
  };
  if (carrier !== undefined) visit(carrier);
  return found;
}

function containsGenericCallable(carrier, visited = new Set()) {
  if (carrier === undefined || visited.has(carrier)) return false;
  visited.add(carrier);
  return rustGenericCallableValue(carrier) !== undefined ||
    rustTargetTypeChildren(carrier).some(child => containsGenericCallable(child, visited));
}

function invariantCode(attempt) {
  try {
    attempt();
  } catch (failure) {
    return failure.diagnostic?.code;
  }
  return undefined;
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

test("two backend plans over a published program read only completed callable stores", () => {
  const current = compileObserved({ surfaces: [], target: { id: "rust", options: { outputType: "bin", crateName: "physical_two_plans" } },
    files: { "index.ts": joinedBinary } });
  assert.deepEqual(current.result.diagnostics.map(diagnostic => diagnostic.code), []);
  const program = current.analyzed;
  const { generic, nativeCaptures } = program.callableValues;
  const implementations = generic.definitions.flatMap(definition => definition.implementations);
  const snapshot = () => ({
    inventory: generic.physical.definitions(),
    environments: implementations.map(implementation => generic.physical.environmentFor(implementation)),
    captures: implementations.map(implementation => nativeCaptures.forDeclaration(implementation.declaration)),
    arguments: generic.physical.definitions().map(definition => generic.physical.argumentsFor(definition.carrier)),
  });
  const before = snapshot();
  assert.equal(before.environments.every(environment => environment !== undefined), true);
  for (let plan = 0; plan < 2; plan += 1) {
    const planned = planRustOutput(createRustPlanningContext(program));
    assert.equal(planned.kind, "resolved", planned.diagnostics?.map(row => row.message).join("; "));
  }
  const after = snapshot();
  assert.equal(after.inventory === before.inventory, true, "no family is admitted by either backend plan");
  for (const field of ["environments", "captures", "arguments"]) {
    assert.equal(after[field].length === before[field].length && after[field].every((value, index) => value === before[field][index]), true,
      `${field} are the same completed objects after two backend plans`);
  }
});

test("a family first requested by an invocation-storage request is admitted after every root and read by producers and dispatch", () => {
  const context = checkedContext(genericObjectMethodStorageSource, { id: "rust", options: { outputType: "lib", crateName: "retained_closure" } });
  const { generic, nativeStorage, nativeGenericProducers, genericDispatch } = context.callableValues.selected;
  const physical = generic.physical;
  const inventory = physical.definitions();
  assert.equal(Object.isFrozen(inventory), true);
  const rooted = new Set();
  for (const node of context.sourceStorage.nodes) {
    const requests = [];
    if (containsGenericCallable(context.records.sourceCallableReturn.get(node)?.returnCarrier)) requests.push(nativeStorage.returnFor(node));
    if (containsGenericCallable(context.records.runtimeCarrier.get(node)?.carrier)) requests.push(nativeStorage.valueFor(node));
    if (context.records.sourceParameterAbi.get(node) !== undefined) requests.push(nativeStorage.parameterFor(node));
    for (const selected of requests) {
      if (selected.kind !== "unresolved") for (const definition of familiesOf(physical, selected.carrier)) rooted.add(definition);
    }
  }
  const invoked = prepareRustGenericCallableDispatchRequests({ ast: context.ast, records: context.records, generic, nativeStorage,
    structuralShapes: context.structuralShapes, nodes: context.sourceStorage.nodes });
  const late = invoked.filter(definition => !rooted.has(definition));
  assert.equal(late.length > 0, true, "an invocation-storage request selects a family that no root or formal request selects");
  const lastRooted = Math.max(...[...rooted].map(definition => inventory.indexOf(definition)));
  for (const definition of late) {
    assert.equal(inventory.indexOf(definition) > lastRooted, true, `${definition.targetName} is admitted after every rooted family`);
    assert.equal(genericDispatch.requiredFor(definition), true, `${definition.targetName} is a required dispatch family`);
  }
  for (const binding of nativeGenericProducers.bindings) assert.equal(inventory.includes(binding.definition), true);
  assert.equal(physical.definitions() === inventory, true, "re-reading invocation storage after closure admits nothing");
});

test("published physical reads return cached exact keys and fail on an unrooted shape after closure", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const physical = program.callableValues.generic.physical;
  const inventory = physical.definitions();
  const joined = inventory.find(definition => definition.members.length === 2);
  assert.equal(joined !== undefined, true);
  const canonical = physical.argumentsFor(joined.carrier);
  assert.deepEqual(canonical, joined.parameters);
  assert.equal(physical.definitionFor(joined.carrier) === joined, true, "the canonical self-carrier links to its own family");
  for (let count = 0; count < 4; count += 1) {
    assert.equal(physical.argumentsFor(joined.carrier) === canonical, true, "a repeated read returns the same result object");
  }
  assert.equal(physical.conversionFor(joined.carrier, joined.carrier)?.kind, "identity");
  const value = rustGenericCallableValue(joined.carrier);
  const reordered = rustGenericCallableCarrier({ ...value, physical: { ...value.physical, members: [...value.physical.members].reverse() } });
  for (const read of [() => physical.definitionFor(reordered), () => physical.argumentsFor(reordered),
    () => physical.conversionFor(reordered, joined.carrier)]) {
    assert.equal(invariantCode(read), "TSONIC_INTERNAL_PLANNER_INVARIANT", "a valid unrooted shape after publication is a planner invariant");
  }
  const foreign = rustGenericCallableCarrier({ ...value, physical: { ...value.physical, members: value.physical.members.map(member =>
    ({ ...member, origin: { ...member.origin, declarationIdentity: "foreign" } })) } });
  assert.equal(physical.definitionFor(foreign) === undefined, true, "an unknown or foreign key stays absent");
  assert.equal(physical.definitions() === inventory, true, "repeated and unrooted reads leave the inventory unchanged");
});

test("identity-observed canonical self-carriers are prepared before closure", () => {
  const context = checkedContext(identityDeclarations, { id: "rust", options: { outputType: "lib" } });
  const physical = context.callableValues.selected.generic.physical;
  const observed = physical.definitions().filter(definition => definition.identityObserved);
  assert.equal(observed.length > 0, true);
  for (const definition of observed) {
    const selected = physical.argumentsFor(definition.carrier);
    assert.equal(selected !== undefined && physical.argumentsFor(definition.carrier) === selected, true, definition.targetName);
    assert.equal(physical.definitionFor(definition.carrier) === definition, true);
    assert.equal(context.callableValues.selected.genericIdentities.forDefinition(definition) !== undefined, true);
  }
});

test("the planner phase label starts at publication, after the callable seal and reachability", () => {
  const context = checkedContext(joinedLibrary, { id: "rust", options: { outputType: "lib" } });
  const physical = context.callableValues.selected.generic.physical;
  const joined = physical.definitions().find(definition => definition.members.length === 2);
  const value = rustGenericCallableValue(joined.carrier);
  const reordered = rustGenericCallableCarrier({ ...value, physical: { ...value.physical, members: [...value.physical.members].reverse() } });
  assert.equal(invariantCode(() => physical.definitionFor(reordered)), "TSONIC_INTERNAL_ANALYSIS_INVARIANT", "closed, not sealed");
  assert.equal(context.callableValues.seal() === context.callableValues.selected, true);
  assert.equal(invariantCode(() => physical.definitionFor(reordered)), "TSONIC_INTERNAL_ANALYSIS_INVARIANT", "sealed, not published");
  context.callableValues.publish();
  assert.equal(invariantCode(() => physical.definitionFor(reordered)), "TSONIC_INTERNAL_PLANNER_INVARIANT", "published");
});

test("published callable plans expose no construction capability", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const { generic, nativeCaptures } = program.callableValues;
  for (const [owner, names] of [[generic, ["initializePhysical"]], [generic.physical, ["carrierFor", "closeAdmission", "publish"]],
    [nativeCaptures, ["require", "complete"]], [program.callableValues, ["finalizeSelected", "initialize", "seal", "publish"]]]) {
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

test("an open environment failure is retried, and a later success is retained once", () => {
  const state = { selections: 0, ready: false };
  const current = construction(factorySource, countedCaptures(state));
  const make = current.declaration("make");
  const [implementation] = current.implementations;
  assert.equal(current.queries.returnFor(make).kind, "unresolved");
  assert.equal(current.queries.returnFor(make).kind, "unresolved");
  assert.equal(state.selections, 2, "an open environment failure is not retained as a completed refusal");
  assert.equal(current.physical.plan.environmentFor(implementation) === undefined, true);
  state.ready = true;
  assert.equal(current.queries.returnFor(make).kind, "selected");
  const environment = current.physical.plan.environmentFor(implementation);
  assert.equal(environment !== undefined && state.selections === 3, true, "the retried environment succeeds once its capture does");
  assert.equal(current.queries.returnFor(make).kind, "selected");
  assert.equal(state.selections === 3 && current.physical.plan.environmentFor(implementation) === environment, true,
    "a completed environment is retained and not selected again");
});

test("a required environment refusal settled at closure is final", () => {
  const state = { selections: 0, ready: false };
  const current = construction(factorySource, countedCaptures(state));
  const [implementation] = current.implementations;
  current.physical.closeAdmission();
  assert.equal(state.selections, 1, "closure settles the required environment once");
  assert.equal(current.physical.plan.environmentFor(implementation) === undefined, true);
  state.ready = true;
  assert.equal(current.queries.returnFor(current.declaration("make")).kind, "unresolved");
  assert.equal(state.selections === 1 && current.physical.plan.environmentFor(implementation) === undefined, true,
    "the settled refusal is not retried after closure");
});

test("a re-entrant environment read during its own construction is not a completed refusal", () => {
  const state = { selections: 0, ready: true, entered: false, inner: undefined };
  let current;
  state.onSelect = () => {
    if (state.entered) return;
    state.entered = true;
    state.inner = current.queries.returnFor(current.declaration("make"));
  };
  current = construction(factorySource, countedCaptures(state));
  const [implementation] = current.implementations;
  const outer = current.queries.returnFor(current.declaration("make"));
  assert.equal(state.inner?.kind === "unresolved" && state.selections === 1, true,
    "the re-entrant read neither selects the capture again nor completes the environment");
  assert.equal(outer.kind, "selected");
  assert.equal(current.physical.plan.environmentFor(implementation) !== undefined, true, "the outer owner retains its own result");
});

test("after closure and capture completion, reads perform no capture selection or environment construction", () => {
  const state = { selections: 0, ready: true };
  const current = construction(factorySource, countedCaptures(state));
  const make = current.declaration("make");
  const selected = current.queries.returnFor(make);
  assert.equal(selected.kind, "selected", selected.reason);
  current.physical.closeAdmission();
  const published = current.captures.complete();
  const settled = state.selections;
  const inventory = current.physical.plan.definitions();
  const environments = current.implementations.map(implementation => current.physical.plan.environmentFor(implementation));
  for (let read = 0; read < 3; read += 1) {
    assert.equal(current.queries.returnFor(make).kind, "selected");
    for (const definition of inventory) {
      current.physical.plan.definitionFor(definition.carrier);
      current.physical.plan.argumentsFor(definition.carrier);
      current.physical.plan.conversionFor(definition.carrier, definition.carrier);
    }
    for (const implementation of current.implementations) published.forDeclaration(implementation.declaration);
  }
  assert.equal(state.selections, settled, "no capture selection after closure and completion");
  assert.equal(current.implementations.every((implementation, index) =>
    current.physical.plan.environmentFor(implementation) === environments[index]), true, "no environment is constructed again");
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
