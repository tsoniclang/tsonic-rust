import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, sourceNodeIdentity, sourceNodesOutsideErasedSubtrees } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { compileRustAnalysisTarget } from "../../helpers/rust-session-compiler-session.mjs";
import { prepareRustGenericCallableDispatchRequests } from "../../../dist/analysis/callables/generic-dispatch.js";
import { createRustGenericCallablePlan, rustFixedStructuralMethodDeclarations } from "../../../dist/analysis/callables/generic-values.js";
import { createRustNativeCallableInputPlan } from "../../../dist/analysis/callables/native-inputs.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustNativeStorageQueries } from "../../../dist/analysis/callables/native-storage.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native-captures.js";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustTargetTypeChildren } from "../../../dist/target-model/types/carriers/children.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";
import { planRustOutput } from "../../../dist/backend/planner/program/index.js";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import { rustTypeFromCarrierInContext } from "../../../dist/backend/planner/types/render.js";
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
    return compileRustAnalysisTarget(request, {
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

function construction(text, wrapCaptures = captures => captures, wrapRecords = records => records, wrapStorage = storage => storage) {
  const { program, source: checked, operationAttempts } = analyzeRust({ surfaces: [], files: { "index.ts": text },
    captureOperationAttempts: true });
  const source = createTargetSourceProgram(checked);
  const storage = wrapStorage(createSourceStorageQuery(source, program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)));
  const records = wrapRecords(program.records);
  const participation = sourceNodesOutsideErasedSubtrees(source.ast, storage.nodes,
    node => program.records.nativeParticipation.get(node) === "erased");
  assert.equal(participation.kind, "resolved", "the checked family domain has complete native participation");
  const nativeNodes = participation.nodes;
  const nativeNodeSet = new Set(nativeNodes);
  const registry = createRustGenericCallablePlan(source.ast, program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile), records, program.names, source.navigation,
    node => nativeNodeSet.has(node), rustFixedStructuralMethodDeclarations(source.ast, program.structuralShapes));
  let physical;
  const input = { source, ast: source.ast, storage, nativeNodes, records, definitions: program.typeDefinitions,
    operationAttempts,
    frames: program.callableValues.frames,
    structuralShapes: program.structuralShapes, projectTypes: program.projectTypes, generic: registry.plan, lexicalFunctions: program.lexicalFunctions,
    lifetimes: program.sourceLifetimes,
    physicalCarrierFor: (carrier, ownerFileName, subject, bindings, producers) =>
      physical.carrierFor(carrier, ownerFileName, subject, bindings, producers) };
  const genericImplementations = new Set(registry.plan.definitions.flatMap(definition => definition.implementations.map(implementation => implementation.declaration)));
  const native = createRustNativeCallableInputPlan({ ...input, sourcePackages: program.host.sourcePackages, usedNames: new Set(),
    ownedRetainedParameter: program.callableValues.native.isNativeRetainedParameter,
    declaresGenericInputs: owner => source.ast.is.IsFunctionDeclaration(owner) || source.ast.is.IsMethodDeclaration(owner) ||
      source.ast.is.IsConstructorDeclaration(owner) || source.ast.is.IsGetAccessorDeclaration(owner) ||
      source.ast.is.IsSetAccessorDeclaration(owner) || genericImplementations.has(owner) ||
      program.lexicalFunctions.forDeclaration(owner)?.kind === "resolved" });
  const producers = createRustNativeCallableProducerPlan({ ...input, native, nodes: nativeNodes,
    returnCarrierFor: declaration => {
      const selected = queries.prepareReturn(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  producers.selectConstructionErrors(new Map());
  const queries = createRustNativeStorageQueries({ ...input, native, producers,
    capturesFor: declaration => captures.forDeclaration(declaration) });
  const captures = wrapCaptures(createRustNativeCapturePlan({ ...input, nativeStorage: queries }));
  physical = registry.initializePhysical({ ...input, native, captures,
    genericBindingsFor: queries.genericBindingsFor,
    boundSubjectFor: (subject, carrier, bindings) => queries.boundSubjectFor(subject, carrier, bindings) });
  const declaration = name => storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  const implementations = registry.plan.definitions.flatMap(definition => definition.implementations);
  return { physical, queries, declaration, implementations, captures, ast: source.ast, storage, program };
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
  assert.equal(context !== undefined, true, "the checked source reaches the actual callable construction owner");
  assert.equal(context.diagnostics.length, 0, context.diagnostics.map(issue =>
    `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
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

const float64 = Object.freeze({ kind: "source-primitive", name: "float64" });

function concreteKey(carrier) {
  const value = rustGenericCallableValue(carrier);
  return rustGenericCallableCarrier({ ...value, physical: { ...value.physical, arguments: value.physical.arguments.map(argument =>
    argument.kind === "type" ? { kind: "type", type: float64 } : argument) } });
}

function reorderedKey(carrier) {
  const value = rustGenericCallableValue(carrier);
  return rustGenericCallableCarrier({ ...value, physical: { ...value.physical, members: [...value.physical.members].reverse() } });
}

function joinedCarrierIn(carrier, visited = new Set()) {
  if (carrier === undefined || visited.has(carrier)) return undefined;
  visited.add(carrier);
  if (rustGenericCallableValue(carrier)?.physical?.members.length === 2) return carrier;
  for (const child of rustTargetTypeChildren(carrier)) {
    const found = joinedCarrierIn(child, visited);
    if (found !== undefined) return found;
  }
  return undefined;
}

function recordingPhysicalReads(program, keys) {
  return { ...program, records: { ...program.records,
    typeEmission: { get(carrier) {
      if (rustGenericCallableValue(carrier)?.physical !== undefined) keys.set(closedMetadataKey(carrier), carrier);
      const selected = program.records.typeEmission.get(carrier);
      return selected;
    } },
  } };
}

function storedKeys(program, keys) {
  const physical = program.callableValues.generic.physical;
  return [...keys].filter(([, carrier]) => {
    const first = physical.existingSelectionFor(carrier);
    return first !== undefined && physical.existingSelectionFor(carrier) === first;
  }).map(([key]) => key).sort();
}

const sameMetadata = (left, right) => closedMetadataKey(left) === closedMetadataKey(right);

function invariantCode(attempt) {
  try {
    attempt();
  } catch (failure) {
    return failure.diagnostic?.code;
  }
  return undefined;
}

function requiredGenericTypeCode(program, unprepared) {
  const definition = program.callableValues.generic.physical.definitions().find(candidate => candidate.members.length === 2);
  assert.equal(definition !== undefined, true, "the source has its real admitted joined family");
  const context = rustSourceFilePlanContext(program, definition.members[0].implementation.declaration);
  assert.equal(rustTypeFromCarrierInContext(definition.carrier, context) !== undefined, true,
    "the same native context renders the exact admitted physical type");
  assert.equal(program.records.typeEmission.get(unprepared) === undefined, true,
    "the unprepared key has no sealed native type record");
  return invariantCode(() => rustTypeFromCarrierInContext(unprepared, context));
}

const factorySource = `
  export function make(callback: () => number): <Value>(value: Value) => Value {
    return <Value>(value: Value): Value => { callback(); return value; };
  }
`;

test("equal native members retain every original source producer and selecting binding before interning", () => {
  const observations = [];
  const activationObservations = [];
  const current = construction(`
    type Identity = <Value>(value: Value) => Value;
    function make(first: number, second: number): Identity {
      return <Value>(value: Value): Value => first > second ? value : value;
    }
    export function choose(leftFirst: number, leftSecond: number, rightFirst: number, rightSecond: number, select: boolean): Identity {
      const left = make(leftFirst, leftSecond); const right = make(rightFirst, rightSecond); return select ? left : right;
    }
  `, undefined, undefined, storage => Object.freeze({ ...storage,
    storageProducersFor(subject, bindings) {
      const selection = storage.storageProducersFor(subject, bindings);
      observations.push({ subject, bindings, selection });
      return selection;
    },
    boundActivationsFor(declaration, bindings) {
      const selection = storage.boundActivationsFor(declaration, bindings);
      activationObservations.push({ declaration, bindings, selection });
      return selection;
    },
  }));
  const owner = current.declaration("choose");
  const selected = current.queries.prepareReturn(owner);
  assert.equal(selected.kind, "selected", selected.reason ?? "the actual returned callable has selected physical storage");
  const source = selected.sources.find(source => source.kind === "complete" && source.subject.node === owner && source.subject.kind === "return");
  assert.equal(source !== undefined, true, "the exact return selection retains its original source producer relation");
  assert.equal(source.producers.length, 2, "two source constructions remain separate before native-member interning");
  assert.equal(source.producers[0].producer.bindings !== source.producers[1].producer.bindings, true,
    "equal native captures never identify two different source creation activations");
  const definition = current.physical.plan.definitionFor(selected.carrier);
  assert.equal(definition !== undefined && definition.members.length === 1, true, "the same native representation is interned once");
  assert.equal(source.producers.every(row => row.member === definition.members[0]), true,
    "each original producer is forward-mapped to the admitted native member, not reverse-matched by target equality");
  const original = observations.find(row => row.subject === source.subject && row.bindings === source.bindings &&
    row.selection.kind === "complete" && row.selection.producers.includes(source.producers[0].producer));
  assert.equal(original !== undefined, true, "the relation retains its exact selecting query subject and owned bindings");
  assert.equal(source.producers.every(row => original.selection.producers.includes(row.producer)), true,
    "every row is the original checked producer object rather than a reconstructed source origin");
  const formalSubjects = current.ast.parameters(current.declaration("make")).map(parameter => current.storage.subject(parameter, "input"));
  const actualSubjects = current.ast.parameters(owner).slice(0, 4).map(parameter => current.storage.subject(parameter, "input"));
  assert.equal([...formalSubjects, ...actualSubjects].every(subject => subject.kind === "resolved"), true,
    "all source formal and actual inputs retain their original checked subject identities");
  const actualPairs = new Set();
  for (const row of source.producers) {
    const selectedInputs = formalSubjects.map(subject => current.storage.boundOriginsFor(subject.subject, row.producer.bindings));
    assert.equal(selectedInputs.every(selection => selection.kind === "resolved"), true,
      "every input in one original alternative is queried with that identical actual source binding token");
    const selectedPair = selectedInputs.map(selection => actualSubjects.findIndex(subject => selection.subjects.includes(subject.subject)));
    assert.equal(selectedPair[0] === 0 && selectedPair[1] === 1 || selectedPair[0] === 2 && selectedPair[1] === 3, true,
      "the two equal-native alternatives keep their original input pairs without a Cartesian product");
    assert.equal(selectedInputs.every((selection, index) => actualSubjects.filter(subject => selection.subjects.includes(subject.subject)).length === 1 &&
      selection.subjects.includes(actualSubjects[selectedPair[index]].subject)), true,
    "a native member shared by both alternatives never merges their distinct source inputs");
    actualPairs.add(selectedPair.join(":"));
    const generic = current.queries.genericBindingsFor(current.declaration("make"), row.producer.bindings);
    assert.equal(generic.kind, "resolved", "the actual producer creation selects its completed native substitutions");
    assert.equal(generic.sourceActivations.kind, "resolved", "the same selector retains its original source activation rows");
    assert.equal(generic.sourceActivations.rows.length > 0, true, "a real invocation has retained source alternatives");
    const observed = activationObservations.find(observation => observation.declaration === current.declaration("make") &&
      observation.bindings === row.producer.bindings && observation.selection.kind === "resolved" &&
      observation.selection.activations.includes(generic.sourceActivations.rows[0].activation));
    assert.equal(observed !== undefined, true, "activation data comes from the original query, not an inverse native binding match");
    assert.equal(generic.sourceActivations.rows.every(alternative => observed.selection.activations.includes(alternative.activation)), true,
      "every source activation remains the original object before native substitution reduction");
    assert.equal(generic.sourceActivations.rows[generic.sourceActivations.rows.length - 1].targetBindings === generic.bindings, true,
      "the existing generic join returns its last actual native substitution without replacing the per-source rows");
    assert.equal(generic.sourceActivations.rows.every(alternative => Object.isFrozen(alternative) &&
      alternative.targetBindings.types !== undefined && alternative.targetBindings.lifetimes !== undefined &&
      alternative.targetBindings.consts !== undefined), true, "every original alternative retains its complete native substitution");
    assert.equal(generic.sourceActivations.rows.every(alternative =>
      [alternative.targetBindings.types, alternative.targetBindings.lifetimes, alternative.targetBindings.consts].every(view =>
        Object.isFrozen(view) && !("set" in view) && !("delete" in view) && !("clear" in view))), true,
    "published activation substitutions expose only the existing canonical immutable map views");
  }
  assert.equal(actualPairs.has("0:1") && actualPairs.has("2:3") && actualPairs.size === 2, true,
    "both original source alternatives survive despite identical native representations and substitutions");
  assert.equal(Object.isFrozen(selected.sources) && Object.isFrozen(source) && Object.isFrozen(source.producers) &&
    source.producers.every(Object.isFrozen), true, "source selection and forward correspondences publish as immutable data");
  const before = selected.sources;
  current.physical.closeAdmission();
  current.physical.closeKeys();
  current.physical.publish();
  assert.equal(current.queries.returnFor(owner).sources === before, true, "publication preserves the same prepared source relation");
  assert.equal(current.queries.prepareReturn(owner) === selected, true, "the one return owner never reselects producers after publication");
});

test("closed native substitutions distinguish original source activations from unavailable evidence", () => {
  const actual = construction("export function closed(): number { return 7; }");
  const owner = actual.declaration("closed");
  const selected = actual.queries.genericBindingsFor(owner, actual.storage.emptyBindings);
  const activations = actual.storage.boundActivationsFor(owner, actual.storage.emptyBindings);
  assert.equal(selected.kind, "resolved", "a closed native substitution does not manufacture a generic environment");
  assert.equal(selected.bindings.types.size + selected.bindings.lifetimes.size + selected.bindings.consts.size, 0);
  assert.equal(selected.sourceActivations.kind, activations.kind, "native target emptiness never determines source availability");
  if (activations.kind === "resolved") {
    assert.equal(selected.sourceActivations.rows.length, activations.activations.length, "all actual source alternatives are retained");
    for (const [index, row] of selected.sourceActivations.rows.entries()) {
      assert.equal(row.activation.declaration === owner, true, "the exact checked declaration owns the activation");
      assert.equal(row.activation.bindings === activations.activations[index].bindings, true, "actual owned source tokens are retained");
      assert.equal(row.targetBindings === selected.bindings, true, "a real source row may have an empty native substitution");
      assert.equal([row.targetBindings.types, row.targetBindings.lifetimes, row.targetBindings.consts].every(view =>
        Object.isFrozen(view) && !("set" in view) && !("delete" in view) && !("clear" in view)), true,
      "target emptiness does not permit a mutable map builder on a published activation");
    }
  } else assert.equal(selected.sourceActivations.reason, activations.reason, "unavailable remains distinct from resolved empty");
  const reason = "the actual source activation is unfinished";
  const pending = construction("export function closed(): number { return 7; }", undefined, undefined,
    storage => Object.freeze({ ...storage, boundActivationsFor: () => Object.freeze({ kind: "unresolved", reason }) }));
  const unavailable = pending.queries.genericBindingsFor(pending.declaration("closed"), pending.storage.emptyBindings);
  assert.equal(unavailable.kind, "resolved", "the independently proven closed target substitution stays valid");
  assert.equal(unavailable.sourceActivations.kind, "unresolved", "no source activation is guessed from native emptiness");
  assert.equal(unavailable.sourceActivations.reason, reason, "the original source refusal is preserved");
  assert.equal(Object.isFrozen(unavailable.sourceActivations), true, "unavailability is immutable data");
});

test("nested generic captures retain their original source selections rather than only the outer native member", () => {
  const observations = [];
  const current = construction(`
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
    function wrap(inner: Identity): Identity {
      return <Value>(value: Value): Value => inner<Value>(value);
    }
    export function choose(callback: () => number): Identity { return wrap(make(callback)); }
  `, undefined, undefined, storage => Object.freeze({ ...storage,
    storageProducersFor(subject, bindings) {
      const selection = storage.storageProducersFor(subject, bindings);
      observations.push({ subject, bindings, selection });
      return selection;
    },
  }));
  const owner = current.declaration("choose");
  const selected = current.queries.prepareReturn(owner);
  assert.equal(selected.kind, "selected", selected.reason ?? "the nested native callable captures its actual inner storage");
  const complete = selected.sources.filter(source => source.kind === "complete");
  const outer = complete.find(source => source.subject.node === owner && source.subject.kind === "return");
  assert.equal(outer !== undefined, true, "the exact outer return relation is retained");
  const inner = complete.filter(source => source !== outer);
  assert.equal(inner.length > 0, true, "nested captured physical selections are not discarded by the outer selector");
  for (const source of inner) {
    assert.equal(source.producers.length > 0, true, "each nested source selection has its real original producers");
    const original = observations.find(observation => observation.subject === source.subject && observation.bindings === source.bindings &&
      observation.selection.kind === "complete" && observation.selection.producers.includes(source.producers[0].producer));
    assert.equal(original !== undefined, true, "the nested selection retains its actual selecting query rather than outer bindings");
    assert.equal(source.producers.every(row => original.selection.producers.includes(row.producer) &&
      row.member.implementation.declaration === row.producer.subject.node && Object.isFrozen(row)), true,
    "the original nested source rows retain their exact admitted implementation correspondence");
  }
  const declarations = new Set(complete.flatMap(source => source.producers.map(row => row.producer.subject.node)));
  const arrows = current.storage.nodes.filter(node => current.ast.is.IsArrowFunction(node));
  assert.equal(arrows.length, 2, "both original generic callable constructions are checked");
  assert.equal(arrows.every(node => declarations.has(node)), true, "the same vector retains both outer and captured original producers");
  assert.equal(selected.sources.every(Object.isFrozen), true, "nested sources remain immutable data, not a query service");
});

test("physical source correspondence rejects foreign source roots and bindings and the removed carrier-only form", () => {
  const current = construction(factorySource);
  const owner = current.declaration("make");
  const selected = current.queries.prepareReturn(owner);
  assert.equal(selected.kind, "selected", selected.reason ?? "the real factory has a prepared physical return");
  const source = selected.sources.find(row => row.kind === "complete" && row.subject.node === owner);
  assert.equal(source !== undefined && source.producers.length !== 0, true, "the actual selection retains all original producer inputs");
  const logical = current.program.records.sourceCallableReturn.get(owner).returnCarrier;
  const file = current.ast.getFileName(current.ast.getSourceFile(owner));
  const producers = source.producers.map(row => row.producer);
  assert.throws(() => current.physical.carrierFor(logical, file, producers),
    /requires its original source subject, bindings and producer vector/u, "the removed carrier-only signature is not a compatibility path");
  assert.equal(current.physical.carrierFor(logical, file, { ...source.subject }, source.bindings, producers) === undefined, true,
    "an equal-looking foreign source subject cannot acquire the selected correspondence");
  assert.equal(current.physical.carrierFor(logical, file, source.subject, { ...source.bindings }, producers) === undefined, true,
    "an equal-looking foreign source binding token cannot acquire the selected correspondence");
  for (const foreign of [
    { ...producers[0], subject: { ...producers[0].subject } },
    { ...producers[0], bindings: { ...producers[0].bindings } },
  ]) assert.equal(current.physical.carrierFor(logical, file, source.subject, source.bindings, [foreign]) === undefined, true,
    "every supplied producer must keep its actual checked source subject and owned creation binding");
  assert.equal(current.physical.carrierFor(logical, file, source.subject, source.bindings, []) === undefined, true,
    "a required generic callable cannot manufacture a known-empty physical producer set");
});

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

test("two backend plans over a published program read completed callable stores and store no physical key", () => {
  const options = { surfaces: [], target: { id: "rust", options: { outputType: "bin", crateName: "physical_two_plans" } },
    files: { "index.ts": joinedBinary } };
  const { program } = analyzeRust(options);
  const { program: unplanned } = analyzeRust(options);
  const { generic, nativeCaptures } = program.callableValues;
  const implementations = generic.definitions.flatMap(definition => definition.implementations);
  const snapshot = () => ({
    inventory: generic.physical.definitions(),
    environments: implementations.map(implementation => generic.physical.environmentFor(implementation)),
    captures: implementations.map(implementation => nativeCaptures.forDeclaration(implementation.declaration)),
    arguments: generic.physical.definitions().map(definition => generic.physical.argumentsFor(definition.carrier)),
  });
  const joined = generic.physical.definitions().find(definition => definition.members.length === 2);
  assert.equal(joined !== undefined, true, "the joined family is admitted before closure");
  const late = concreteKey(joined.carrier);
  const unstored = () => {
    assert.equal(generic.physical.existingSelectionFor(late) === undefined, true, "a fabricated unprepared key remains absent");
    assert.equal(requiredGenericTypeCode(program, late), "TSONIC_INTERNAL_PLANNER_INVARIANT",
      "required unprepared keys fail without computing or storing a selection");
  };
  const before = snapshot();
  assert.equal(before.environments.every(environment => environment !== undefined), true);
  unstored();
  const read = new Map();
  for (let plan = 0; plan < 2; plan += 1) {
    const planned = planRustOutput(createRustPlanningContext(recordingPhysicalReads(program, read)));
    assert.equal(planned.kind, "resolved", planned.diagnostics?.map(row => row.message).join("; "));
  }
  assert.equal(read.size > 0, true, "the backend reads physical keys");
  const plannedKeys = storedKeys(program, read);
  const unplannedKeys = storedKeys(unplanned, read);
  assert.equal(plannedKeys.length === unplannedKeys.length && plannedKeys.every((key, index) => key === unplannedKeys[index]), true,
    `every key the backend read is stored exactly as in the same program analyzed without a backend plan: ${plannedKeys.length} and ${unplannedKeys.length} stored of ${read.size}`);
  unstored();
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

test("published physical reads return stored keys and reject required unprepared keys without selection", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const physical = program.callableValues.generic.physical;
  const inventory = physical.definitions();
  const joined = inventory.find(definition => definition.members.length === 2);
  assert.equal(joined !== undefined, true);
  const canonical = physical.argumentsFor(joined.carrier);
  const recorded = new Map();
  const context = rustSourceFilePlanContext(recordingPhysicalReads(program, recorded), joined.members[0].implementation.declaration);
  assert.equal(rustTypeFromCarrierInContext(joined.carrier, context) !== undefined && recorded.size > 0, true,
    "the current native type consumer reads the real sealed physical carrier");
  assert.equal(storedKeys(program, recorded).length, recorded.size, "every recorded native type key was already stored");
  assert.equal(sameMetadata(canonical, joined.parameters), true, "the canonical key links the family's own parameters");
  assert.equal(physical.definitionFor(joined.carrier) === joined, true, "the canonical self-carrier links to its own family");
  for (let count = 0; count < 4; count += 1) {
    assert.equal(physical.argumentsFor(joined.carrier) === canonical, true, "a repeated read returns the same result object");
  }
  assert.equal(physical.conversionFor(joined.carrier, joined.carrier)?.kind, "identity");
  const late = concreteKey(joined.carrier);
  for (const read of [() => physical.argumentsFor(late), () => physical.definitionFor(late)]) {
    assert.equal(read() === undefined, true, "an optional immutable physical lookup does not compute an unprepared key");
  }
  assert.equal(requiredGenericTypeCode(program, late), "TSONIC_INTERNAL_PLANNER_INVARIANT",
    "unprepared required keys fail at the actual native type consumer without selecting or storing a family");
  assert.equal(physical.existingSelectionFor(late) === undefined, true, "a missing optional key is not admitted by a read");
  const value = rustGenericCallableValue(joined.carrier);
  const reordered = reorderedKey(joined.carrier);
  for (const read of [() => physical.definitionFor(reordered), () => physical.argumentsFor(reordered),
    () => physical.conversionFor(reordered, joined.carrier)]) {
    assert.equal(read() === undefined, true, "optional reads of a valid unrooted shape remain absent after publication");
  }
  assert.equal(requiredGenericTypeCode(program, reordered), "TSONIC_INTERNAL_PLANNER_INVARIANT",
    "the native consumer refuses the same valid but unrooted physical shape after publication");
  assert.equal(physical.existingSelectionFor(reordered) === undefined, true, "an optional read of a valid unrooted shape stays absent");
  const logical = rustGenericCallableCarrier({ origin: value.origin, signature: value.signature, environment: value.environment });
  assert.equal(physical.definitionFor(logical) === undefined, true, "a logical carrier is not a physical storage key");
  const foreign = rustGenericCallableCarrier({ ...value, physical: { ...value.physical, members: value.physical.members.map(member =>
    ({ ...member, origin: { ...member.origin, declarationIdentity: "foreign" } })) } });
  assert.equal(physical.definitionFor(foreign) === undefined, true, "an unknown or foreign key stays absent");
  assert.equal(physical.definitions() === inventory, true, "repeated and unrooted reads leave the inventory unchanged");
});

test("before closure, a required read of a physical shape construction never admitted is an analysis invariant", () => {
  const current = construction(joinedLibrary);
  const selected = current.queries.prepareReturn(current.declaration("choose"));
  assert.equal(selected.kind, "selected", selected.reason);
  const joined = joinedCarrierIn(selected.carrier);
  assert.equal(joined !== undefined && current.physical.plan.definitionFor(joined) !== undefined, true, "an admitted shape links before closure");
  const reordered = reorderedKey(joined);
  assert.equal(current.physical.plan.existingSelectionFor(reordered) === undefined, true, "an optional read stays absent");
  for (const read of [() => current.physical.plan.definitionFor(reordered), () => current.physical.plan.argumentsFor(reordered)]) {
    assert.equal(invariantCode(read), "TSONIC_INTERNAL_ANALYSIS_INVARIANT", "a required read does not report a missing family as absence");
  }
  current.physical.closeAdmission();
  assert.equal(current.physical.plan.existingSelectionFor(reordered) === undefined, true, "the failed reads admitted no family");
});

test("published physical ownership preserves logical origins, signatures, members and source-file boundaries", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedLibrary } });
  const physical = program.callableValues.generic.physical;
  const joined = physical.definitions().find(definition => definition.members.length === 2);
  assert.equal(joined !== undefined, true, "the fixture owns a joined physical family");
  const value = rustGenericCallableValue(joined.carrier);
  const foreignKeys = [
    ["logical origin", rustGenericCallableCarrier({ ...value, origin: { ...value.origin, declarationIdentity: "foreign" } })],
    ["signature", rustGenericCallableCarrier({ ...value, signature: { ...value.signature, result: float64 } })],
    ["source owner", rustGenericCallableCarrier({ ...value, physical: { ...value.physical, ownerFileName: "/foreign.rs" } })],
    ["member origin", rustGenericCallableCarrier({ ...value, physical: { ...value.physical,
      members: value.physical.members.map(member => ({ ...member, origin: { ...member.origin, declarationIdentity: "foreign" } })) } })],
  ];
  for (const [label, carrier] of foreignKeys) {
    for (const [reader, read] of [["definitionFor", () => physical.definitionFor(carrier)],
      ["argumentsFor", () => physical.argumentsFor(carrier)], ["existingSelectionFor", () => physical.existingSelectionFor(carrier)],
      ["conversionFor source", () => physical.conversionFor(carrier, joined.carrier)],
      ["conversionFor target", () => physical.conversionFor(joined.carrier, carrier)]]) {
      assert.equal(read() === undefined, true, `${label}: ${reader} leaves a foreign or inconsistent key absent`);
    }
  }
  assert.equal(physical.definitionFor(joined.carrier) === joined, true, "foreign queries never change the owned selection");
});

test("a logical carrier whose family was never admitted stays absent in every reader", () => {
  const current = construction(`export function make(): <Value>(value: Value) => Value { return <Value>(value: Value): Value => value; }`);
  const [implementation] = current.implementations;
  const logical = implementation.carrier;
  assert.equal(rustGenericCallableValue(logical) !== undefined && rustGenericCallableValue(logical).physical === undefined, true,
    "the implementation carrier is logical");
  current.physical.closeAdmission();
  assert.equal(current.physical.plan.definitions().length === 0 && current.physical.plan.environmentFor(implementation) !== undefined, true,
    "the family has a completed environment and no admitted shape");
  const physical = current.physical.closeKeys();
  current.physical.publish();
  for (const [name, read] of [["definitionFor", () => physical.definitionFor(logical)], ["argumentsFor", () => physical.argumentsFor(logical)],
    ["existingSelectionFor", () => physical.existingSelectionFor(logical)], ["conversionFor", () => physical.conversionFor(logical, logical)]]) {
    assert.equal(invariantCode(read) === undefined && read() === undefined, true, `${name}: a logical carrier is not a physical storage key`);
  }
});

test("every family's canonical self-carrier is stored at closure, including identity-observed families", () => {
  const context = checkedContext(identityDeclarations, { id: "rust", options: { outputType: "lib" } });
  const physical = context.callableValues.selected.generic.physical;
  const inventory = physical.definitions();
  assert.equal(inventory.some(definition => definition.identityObserved), true);
  for (const definition of inventory) {
    const selected = physical.argumentsFor(definition.carrier);
    assert.equal(selected !== undefined && physical.argumentsFor(definition.carrier) === selected, true, definition.targetName);
    assert.equal(physical.definitionFor(definition.carrier) === definition, true);
    if (definition.identityObserved) assert.equal(context.callableValues.selected.genericIdentities.forDefinition(definition) !== undefined, true);
  }
});

test("closure prepares the canonical self-carrier of every admitted family", () => {
  const current = construction(joinedLibrary);
  const selected = current.queries.prepareReturn(current.declaration("choose"));
  assert.equal(selected.kind, "selected", selected.reason);
  current.physical.closeAdmission();
  const inventory = current.physical.plan.definitions();
  assert.equal(inventory.length > 0 && inventory.every(definition => definition.parameters.length > 0), true,
    "admission selects concrete physical arguments, never the canonical parameters");
  const lateKeys = [];
  for (const definition of inventory) {
    const prepared = current.physical.plan.argumentsFor(definition.carrier);
    assert.equal(sameMetadata(prepared, definition.parameters), true, `${definition.targetName}: the canonical key links the family's own parameters`);
    assert.equal(current.physical.plan.argumentsFor(definition.carrier) === prepared, true,
      `${definition.targetName}: the canonical key read after closure is the one stored at closure`);
    const late = concreteKey(definition.carrier);
    current.physical.prepare(late);
    lateKeys.push(late);
  }
  const published = current.physical.closeKeys();
  current.physical.publish();
  for (const late of lateKeys) {
    const selected = published.argumentsFor(late);
    assert.equal(selected !== undefined, true, "explicit key preparation links the admitted physical family");
    assert.equal(published.argumentsFor(late) === selected, true,
      "actual prepared keys are stable lookups after publication");
  }
});

test("a selected identity issue on a provider callback argument keeps the base diagnostic list", () => {
  const source = `type Identity = <Value>(value: Value) => Value;
export function run(left: Identity, right: Identity, values: number[]): boolean {
  return values.reduce((same: boolean, item: number): boolean => same && item > 0, left === right);
}
`;
  const { result, source: checked } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  const ast = createTargetSourceProgram(checked).ast;
  const comparison = source.indexOf("left === right");
  assert.deepEqual(result.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message,
    start: ast.pos(diagnostic.sourceNode), end: ast.end(diagnostic.sourceNode) })), [{
    code: "RUST_CALLABLE_VALUE_NOT_CLOSED",
    message: "Native callable identity requires exact owned physical producers and their selected source comparison.",
    start: comparison - 1, end: comparison + "left === right".length,
  }], "the effect passes resolving the not-yet-rejected comparison add no record or diagnostic");
  assert.equal(result.artifacts.length, 0);
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
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
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
  assert.throws(() => current.queries.prepareReturn(make), failure =>
    failure.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" && /admission closed/u.test(failure.message));
  assert.equal(current.physical.plan.definitions() === inventory, true);
  current.physical.closeKeys();
  current.physical.publish();
  assert.throws(() => current.queries.prepareReturn(make), failure =>
    failure.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" &&
    /physical construction cannot run after key closure/u.test(failure.message));
  assert.throws(() => current.physical.closeAdmission(), /exactly once/u);
});

test("families admitted before closure remain linkable after closure without new definitions", () => {
  const current = construction(factorySource);
  const make = current.declaration("make");
  const selected = current.queries.prepareReturn(make);
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
  assert.equal(current.queries.prepareReturn(make).kind, "unresolved");
  assert.equal(current.queries.prepareReturn(make).kind, "unresolved");
  assert.equal(state.selections, 2, "an open environment failure is not retained as a completed refusal");
  assert.equal(current.physical.plan.environmentFor(implementation) === undefined, true);
  state.ready = true;
  assert.equal(current.queries.prepareReturn(make).kind, "selected");
  const environment = current.physical.plan.environmentFor(implementation);
  assert.equal(environment !== undefined && state.selections === 3, true, "the retried environment succeeds once its capture does");
  assert.equal(current.queries.prepareReturn(make).kind, "selected");
  assert.equal(state.selections === 3 && current.physical.plan.environmentFor(implementation) === environment, true,
    "a completed environment is retained and not selected again");
});

test("an open physical conversion retries an unfinished environment instead of retaining its provisional absence", () => {
  const state = { selections: 0, ready: false };
  const current = construction(`export function make(): <Value>(value: Value) => Value {
    return <Value>(value: Value): Value => value;
  }`, countedCaptures(state));
  const [implementation] = current.implementations;
  assert.equal(implementation !== undefined && current.implementations.length === 1, true, "one actual source implementation");
  const value = rustGenericCallableValue(implementation.carrier);
  const carrier = rustGenericCallableCarrier({ ...value, physical: { ownerFileName: implementation.sourceFileName,
    members: [{ origin: { fileName: implementation.sourceFileName,
      declarationIdentity: sourceNodeIdentity(current.ast, implementation.declaration) }, arguments: [] }], arguments: [] } });
  const early = current.physical.plan;
  assert.equal(early.conversionFor(carrier, carrier) === undefined, true, "unfinished capture evidence is absent while open");
  assert.equal(state.selections, 0, "a conversion read does not construct a capture environment");
  state.ready = true;
  const completed = current.queries.prepareReturn(current.declaration("make"));
  assert.equal(completed.kind, "selected", completed.reason);
  assert.equal(sameMetadata(completed.carrier, carrier), true, "the completed actual producer selects the identical physical key");
  const conversion = early.conversionFor(carrier, carrier);
  assert.equal(conversion?.kind, "identity", "the same open query observes the now-complete producer environment");
  current.physical.closeAdmission();
  current.physical.closeKeys();
  current.physical.publish();
  assert.equal(early.conversionFor(carrier, carrier) === conversion, true, "the captured reader uses the final prepared conversion");
  assert.equal(state.selections, 1, "completion does not select the capture again");
});

test("private logical leaf construction retries unfinished source evidence and retains only the completed carrier", () => {
  const state = { hidden: undefined };
  const current = construction("export function read(value: number): number { return value; }", undefined,
    records => Object.freeze({ ...records, sourceParameterAbi: Object.freeze({
      get: node => node === state.hidden ? undefined : records.sourceParameterAbi.get(node),
    }) }));
  const parameter = current.ast.parameters(current.declaration("read"))[0];
  const subject = current.storage.subject(parameter, "input");
  assert.equal(subject.kind, "resolved", "the actual formal has its canonical private source-storage subject");
  state.hidden = parameter;
  assert.equal(current.queries.logicalCarrierFor(subject.subject, current.storage.emptyBindings) === undefined, true,
    "unfinished source ABI evidence has no derived logical leaf");
  state.hidden = undefined;
  const completed = current.queries.logicalCarrierFor(subject.subject, current.storage.emptyBindings);
  assert.equal(completed !== undefined && sameMetadata(completed,
    current.program.records.sourceParameterAbi.get(parameter).parameterCarrier), true, "the identical query reads the actual completed ABI");
  assert.equal(current.queries.logicalCarrierFor(subject.subject, current.storage.emptyBindings) === completed, true,
    "completed derived evidence is retained once in the private construction owner");
  assert.equal("logicalCarrierFor" in current.program.callableValues.nativeStorage, false,
    "the logical construction reader is not a published native-storage service");
});

test("a required environment refusal settled at closure is final", () => {
  const state = { selections: 0, ready: false };
  const current = construction(factorySource, countedCaptures(state));
  const [implementation] = current.implementations;
  current.physical.closeAdmission();
  assert.equal(state.selections, 1, "closure settles the required environment once");
  assert.equal(current.physical.plan.environmentFor(implementation) === undefined, true);
  state.ready = true;
  assert.equal(current.queries.prepareReturn(current.declaration("make")).kind, "unresolved");
  assert.equal(state.selections === 1 && current.physical.plan.environmentFor(implementation) === undefined, true,
    "the settled refusal is not retried after closure");
});

test("a re-entrant environment read during its own construction is not a completed refusal", () => {
  const state = { selections: 0, ready: true, entered: false, inner: undefined };
  let current;
  state.onSelect = () => {
    if (state.entered) return;
    state.entered = true;
    state.inner = current.queries.prepareReturn(current.declaration("make"));
  };
  current = construction(factorySource, countedCaptures(state));
  const [implementation] = current.implementations;
  const outer = current.queries.prepareReturn(current.declaration("make"));
  assert.equal(state.inner?.kind === "unresolved" && state.selections === 1, true,
    "the re-entrant read neither selects the capture again nor completes the environment");
  assert.equal(outer.kind, "selected");
  assert.equal(current.physical.plan.environmentFor(implementation) !== undefined, true, "the outer owner retains its own result");
});

test("after closure and capture completion, reads perform no capture selection or environment construction", () => {
  const state = { selections: 0, ready: true };
  const current = construction(factorySource, countedCaptures(state));
  const make = current.declaration("make");
  const selected = current.queries.prepareReturn(make);
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
  const records = createRustRecordFixture({ closureCapture: { get: node => facts.get(node) } });
  state.plan = createRustNativeCapturePlan({
    records,
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
