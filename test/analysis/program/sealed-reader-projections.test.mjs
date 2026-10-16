import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { compileRust, int32Carrier } from "../../helpers/rust-session.mjs";
import { keelOwnedTargets } from "../../../../tsonic/test/architecture/tooling/keel-owned-contracts.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`registered lookup readers consume only completed immutable producer data on ${surfaces[0] ?? "native"}`, () => {
    const gate = { closed: false, queries: 0, afterSeal: 0 };
    let program;
    let guardedSource;
    const compiled = compileRust({ surfaces, files: { "index.ts": `
enum Code { First = 1, Second = 2 }
class Item {
  value: number;
  constructor(value: number) { this.value = value; }
  read(): number { return this.value; }
}
export function value(limit: number): number {
  const item = new Item(limit);
  const code = Code.Second;
  let total: number = limit;
  for (let index = 0; index < 3; index++) { total = item.read(); }
  return total;
}
` }, compileTarget(request) {
      const source = request.input.source;
      guardedSource = { ...source,
        ast: guardedServices(source.ast, gate, "ast"),
        navigation: guardedServices(source.navigation, gate, "navigation"),
        semantics: guardedServices(source.semantics, gate, "semantics"),
        sourceFacts: guardedServices(source.sourceFacts, gate, "sourceFacts"),
      };
      const result = analyzeRustTargetProgram({ ...request,
        input: { ...request.input, source: guardedSource } });
      if (result.kind === "rejected") return result;
      program = result.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: result.diagnostics };
    } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
    assert.equal(program !== undefined, true, "the real target analysis must publish a completed program");
    assert.equal(Object.isFrozen(program), true);
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      program.source.ast.forEachChild(node, visit);
    };
    program.sourceFiles.forEach(visit);
    const definitions = program.projectTypes.definitions;
    const item = definitions.find(definition => definition.sourceName === "Item");
    assert.equal(item !== undefined, true, "the checked constructor fixture has a real definition");
    const carriers = definitions.map(definition => program.projectTypes.openCarrier(definition));
    const itemCarrier = program.projectTypes.openCarrier(item);
    const foreign = Object.freeze({ identity: "foreign-checked-subject" });
    const components = program.sourcePackageComponents.components.map(component => component.componentId);
    const constructors = () => program.projectConstructions.forDefinition(item);
    const captures = program.objectRepresentations.receiverCaptures;
    const reader = (symbol, inputs, read, unknown, absent = "undefined") => ({ symbol, inputs, read, unknown, absent });
    const readers = [
      reader("RustCountedLoopRepresentationPlan.representationFor", nodes, node => program.countedLoops.representationFor(node), () => program.countedLoops.representationFor(foreign)),
      reader("RustEnumMemberConstantIndex.forMember", nodes, node => program.enumMemberConstants.forMember(node), () => program.enumMemberConstants.forMember(foreign)),
      reader("RustNumericRepresentations.usesInt32Remainder", nodes, node => program.numericRepresentations.usesInt32Remainder(node), () => program.numericRepresentations.usesInt32Remainder(foreign), "false"),
      reader("RustClassValuePlan.forCarrier", carriers, carrier => program.classValues.forCarrier(carrier), () => program.classValues.forCarrier(int32Carrier)),
      reader("RustClassValuePlan.forDeclaration", nodes, node => program.classValues.forDeclaration(node), () => program.classValues.forDeclaration(foreign)),
      reader("RustClassValuePlan.viewFor", nodes, node => program.classValues.viewFor(node, itemCarrier, itemCarrier), () => program.classValues.viewFor(foreign, itemCarrier, itemCarrier)),
      reader("RustFrozenDataWritePlan.capturesFieldIdentity", nodes, node => program.frozenDataWrites.capturesFieldIdentity(node), () => program.frozenDataWrites.capturesFieldIdentity(foreign), "false"),
      reader("RustFrozenDataWritePlan.receiverForDeclaration", nodes, node => program.frozenDataWrites.receiverForDeclaration(node), () => program.frozenDataWrites.receiverForDeclaration(foreign)),
      reader("RustBorrowedElementReads.forExpression", nodes, node => program.borrowedElementReads.forExpression(node), () => program.borrowedElementReads.forExpression(foreign)),
      reader("RustBorrowedElementReads.forIteration", nodes, node => program.borrowedElementReads.forIteration(node), () => program.borrowedElementReads.forIteration(foreign)),
      reader("RustBorrowedElementReads.forStatement", nodes, node => program.borrowedElementReads.forStatement(node), () => program.borrowedElementReads.forStatement(foreign)),
      reader("RustErrorTransportQueries.forComponent", components, component => program.errorTransport.forComponent(component), () => program.errorTransport.forComponent("foreign-component")),
      reader("RustProjectConstructionQueries.externalInitializationForCall", nodes, node => program.projectConstructions.externalInitializationForCall(node), () => program.projectConstructions.externalInitializationForCall(foreign)),
      reader("RustProjectConstructionQueries.forDefinition", definitions, definition => program.projectConstructions.forDefinition(definition), () => program.projectConstructions.forDefinition(foreign)),
      reader("RustConstructionPointQueries.expressionsWithin", nodes, node => constructors().expressionsWithin(node), () => constructors().expressionsWithin(foreign), "empty"),
      reader("RustConstructionPointQueries.layerCompletes", definitions, definition => constructors().layerCompletes(definition), () => constructors().layerCompletes(foreign), "false"),
      reader("RustConstructionPointQueries.layerHasEarlyReturn", definitions, definition => constructors().layerHasEarlyReturn(definition), () => constructors().layerHasEarlyReturn(foreign), "false"),
      reader("RustConstructionPointQueries.mutatesUnpublishedField", nodes, node => constructors().mutatesUnpublishedField(node), () => constructors().mutatesUnpublishedField(foreign), "false"),
      reader("RustConstructionPointQueries.pointFor", nodes, node => constructors().pointFor(node), () => constructors().pointFor(foreign)),
      reader("RustProjectFieldDispatchQueries.implementationFor", nodes, node => program.projectFieldDispatch.implementationFor(item, node), () => program.projectFieldDispatch.implementationFor(foreign, foreign)),
      reader("RustProjectFieldDispatchQueries.planFor", nodes, node => program.projectFieldDispatch.planFor(node), () => program.projectFieldDispatch.planFor(foreign)),
      reader("RustProjectMethodPropertyPlan.usageFor", nodes, node => program.projectMethodProperties.usageFor(node), () => program.projectMethodProperties.usageFor(foreign)),
      reader("RustObjectRepresentationPlan.representationFor", definitions, definition => program.objectRepresentations.representationFor(definition), () => program.objectRepresentations.representationFor(foreign)),
      reader("RustReceiverFieldCaptureQueries.fixedSelfFor", nodes, node => captures.fixedSelfFor(node), () => captures.fixedSelfFor(foreign)),
      reader("RustReceiverFieldCaptureQueries.fixedSelfForReference", nodes, node => captures.fixedSelfForReference(node), () => captures.fixedSelfForReference(foreign)),
      reader("RustReceiverFieldCaptureQueries.isCaptured", nodes, node => captures.isCaptured(node), () => captures.isCaptured(foreign), "false"),
      reader("RustReceiverFieldCaptureQueries.storageDeclaration", nodes, node => captures.storageDeclaration(node), () => captures.storageDeclaration(foreign), "identity"),
      reader("RustReceiverFieldAliasQueries.aliasFor", nodes, node => program.objectRepresentations.aliasFor(node), () => program.objectRepresentations.aliasFor(foreign)),
      reader("RustBinaryDispatchDemandPlan.forHook", program.binaryHooks.map(hook => hook.id), hook => program.binaryDispatchDemand.forHook(hook), () => program.binaryDispatchDemand.forHook("foreign-hook")),
      reader("RustDispatchContextCatalog.declaration", program.dispatchContexts.contexts.map(context => context.id), context => program.dispatchContexts.declaration(context), () => program.dispatchContexts.declaration("foreign-context")),
      reader("RustDispatchContextDemandPlan.forComponent", components, component => program.dispatchContextDemand.forComponent(component), () => program.dispatchContextDemand.forComponent("foreign-component")),
      reader("RustSourceModuleConstructionIndex.construction", nodes, node => program.sourceModuleConstructions.construction(node), () => program.sourceModuleConstructions.construction(foreign)),
      reader("RustSourceModuleConstructionIndex.entries", [undefined], () => program.sourceModuleConstructions.entries(), () => program.sourceModuleConstructions.entries(), "collection"),
      reader("RustSourceModuleConstructionIndex.from", program.sourceFiles, file => program.sourceModuleConstructions.from(file), () => program.sourceModuleConstructions.from(foreign), "empty"),
      reader("RustSourceModuleConstructionIndex.targets", [undefined], () => program.sourceModuleConstructions.targets(), () => program.sourceModuleConstructions.targets(), "collection"),
      reader("RustBorrowedInitializerQueries.forExpression", nodes, node => program.borrowedInitializers.forExpression(node), () => program.borrowedInitializers.forExpression(foreign)),
      reader("RustCaptureStoragePlan.deferredForScope", nodes, node => program.captureStorage.deferredForScope(node), () => program.captureStorage.deferredForScope(foreign), "empty"),
      reader("RustCaptureStoragePlan.iterationsForScope", nodes, node => program.captureStorage.iterationsForScope(node), () => program.captureStorage.iterationsForScope(foreign), "empty"),
      reader("RustLocalStorageAliasPlan.owner", nodes, node => program.localStorageAliases.owner(node), () => program.localStorageAliases.owner(foreign)),
      reader("RustLocalStorageAliasPlan.requiresMutableOwner", nodes, node => program.localStorageAliases.requiresMutableOwner(node), () => program.localStorageAliases.requiresMutableOwner(foreign), "false"),
      reader("RustProviderMutableInputPlan.forOperation", nodes, node => program.providerMutableInputs.forOperation(node), () => program.providerMutableInputs.forOperation(foreign)),
    ];
    const declared = new Set(keelOwnedTargets["tsonic-rust"].recordReaders.map(entry => entry.symbol));
    assert.equal(readers.length, 41);
    assert.equal(readers.every(current => declared.has(current.symbol)), true,
      "all and only the exact audited contracts must be registered");
    assert.equal(new Set(readers.map(current => current.symbol)).size, 41);
    assert.equal(nodes.length > 40, true, "the fixture contains actual checked source subjects");
    gate.closed = true;
    let positiveObjects = 0;
    let frozenArrays = 0;
    withoutProducerWrites(() => {
      for (const current of readers) {
        for (const input of current.inputs) {
          const first = current.read(input);
          const second = current.read(input);
          requireStable(first, second, current.symbol);
          if (first !== null && typeof first === "object" && !Array.isArray(first)) positiveObjects++;
          if (Array.isArray(first)) frozenArrays++;
        }
        const absent = current.unknown();
        requireStable(absent, current.unknown(), current.symbol + " unknown key");
        if (current.absent === "undefined" && absent !== undefined || current.absent === "false" && absent !== false ||
          current.absent === "identity" && absent !== foreign ||
          current.absent === "empty" && (!Array.isArray(absent) || absent.length !== 0)) {
          throw new Error(`${current.symbol} has the wrong foreign-key result.`);
        }
      }
    });
    assert.equal(gate.queries > 0, true, "the guards forward the real producer's queries before publication");
    assert.equal(gate.afterSeal, 0, "no registered reader queries source or policy services after publication");
    assert.equal(positiveObjects > 10, true, "known keys exercise actual stored objects rather than only absence");
    assert.equal(frozenArrays > nodes.length, true, "nonempty domains and shared immutable empties are exercised");
    assert.throws(() => guardedSource.ast.kindName(program.sourceFiles[0]), /queried after publication/u);
    assert.equal(gate.afterSeal, 1, "a lazy source query would be observed and refused");
    assert.throws(() => withoutProducerWrites(() => new Map().set(foreign, foreign)), /mutated after publication/u);
    assert.throws(() => requireStable([], [], "fresh-array negative control"), /changed returned identity/u);
    const mutable = [];
    assert.throws(() => requireStable(mutable, mutable, "mutable-array negative control"), /returned a mutable array/u);
  });
}

function requireStable(first, second, label) {
  if (!Object.is(first, second)) throw new Error(`${label} changed returned identity.`);
  if (Array.isArray(first) && !Object.isFrozen(first)) throw new Error(`${label} returned a mutable array.`);
}

function guardedServices(service, gate, label, cache = new WeakMap()) {
  if (service === undefined || service === null) return service;
  const previous = cache.get(service);
  if (previous !== undefined) return previous;
  const methods = new Map();
  const facade = new Proxy(Object.create(null), {
    ownKeys() { return Reflect.ownKeys(service); },
    has(_target, property) { return Reflect.has(service, property); },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(service, property);
      return descriptor === undefined ? undefined : {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => facade[property],
      };
    },
    get(_target, property) {
      const value = Reflect.get(service, property, service);
      if (typeof value === "function") {
        if (!methods.has(property)) methods.set(property, (...args) => {
          if (gate.closed) {
            gate.afterSeal++;
            throw new Error(`${label}.${String(property)} queried after publication.`);
          }
          gate.queries++;
          const result = Reflect.apply(value, service, args);
          return property === "forNode" || property === "forFile"
            ? guardedServices(result, gate, `${label}.${String(property)}`, cache) : result;
        });
        return methods.get(property);
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value) &&
        Reflect.ownKeys(value).some(key => typeof value[key] === "function")) {
        return guardedServices(value, gate, `${label}.${String(property)}`, cache);
      }
      return value;
    },
  });
  cache.set(service, facade);
  return facade;
}

function withoutProducerWrites(operation) {
  const methods = [[Map.prototype, "set"], [Map.prototype, "delete"], [Map.prototype, "clear"],
    [Set.prototype, "add"], [Set.prototype, "delete"], [Set.prototype, "clear"],
    [WeakMap.prototype, "set"], [WeakMap.prototype, "delete"],
    [WeakSet.prototype, "add"], [WeakSet.prototype, "delete"]];
  const originals = methods.map(([owner, name]) => [owner, name, owner[name]]);
  try {
    for (const [owner, name] of methods) owner[name] = () => { throw new Error(`${name} mutated after publication.`); };
    operation();
  } finally {
    for (const [owner, name, original] of originals) owner[name] = original;
  }
}
