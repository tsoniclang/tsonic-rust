import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageConstructionSelection,
  SourceStorageDomainBoundary, SourceStorageSubject, SourceStorageQueries, TargetUseSiteRef }
  from "@tsonic/target-api/analysis";
import type { RustInitializationErrorRecords, RustInitializerSelection, RustModuleErrorInitializer }
  from "../../target-model/records/error-regions.js";
import type { RustPhysicalCallableSourceProducer, RustPhysicalCallableSourceSelection,
  RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigin, RustPhysicalEmissionSourceOrigins }
  from "../../target-model/records/physical-emission-contexts.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustProjectConstructionPlan, RustConstructionLayer } from "../project-types/construction-plan.js";
import type { RustGenericCallablePhysicalPlan } from "./generic-physical.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustPhysicalCallableEmissionRequest, RustPhysicalCallableStorage } from "./physical-lifecycle.js";

export type RustEmissionSourceOwner =
  | { readonly kind: "declaration" }
  | { readonly kind: "callable"; readonly implementation: Node; readonly member: object | undefined }
  | { readonly kind: "construction"; readonly plan: RustProjectConstructionPlan; readonly layer: RustConstructionLayer | undefined }
  | { readonly kind: "module"; readonly module: RustModuleErrorInitializer; readonly initializers: readonly RustInitializerSelection[] }
  | { readonly kind: "worker"; readonly initializer: RustInitializerSelection };

export interface RustEmissionSourceRequest {
  readonly use: TargetUseSiteRef;
  readonly declaration: Node;
  readonly bindings: RustTargetGenericBindings;
  readonly demands: readonly RustPhysicalCallableEmissionRequest[];
  readonly source: RustEmissionSourceOwner;
}

interface RustEmissionSourceInput {
  readonly sourceStorage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly nativeStorage: RustPhysicalCallableStorage;
  readonly genericBindingsFor: RustNativeStoragePlan["genericBindingsFor"];
  readonly physical: Pick<RustGenericCallablePhysicalPlan, "definitions">;
  readonly emissionRequests: readonly RustPhysicalCallableEmissionRequest[];
  readonly initialization: RustInitializationErrorRecords;
}

type Origins =
  | { readonly kind: "resolved"; readonly alternatives: readonly RustPhysicalEmissionSourceOrigin[] }
  | { readonly kind: "open"; readonly alternatives: readonly RustPhysicalEmissionSourceOrigin[];
      readonly boundaries: readonly SourceStorageDomainBoundary[] }
  | { readonly kind: "unavailable"; readonly reason: string;
      readonly alternatives: readonly RustPhysicalEmissionSourceOrigin[]; readonly boundaries: readonly SourceStorageDomainBoundary[] };

type Construction = Extract<SourceStorageConstructionSelection, { readonly kind: "resolved" }>["alternatives"][number];
type Bindings = Extract<SourceStorageBindingsSelection, { readonly kind: "resolved" }>;
type ConstructionOrigin = Extract<RustPhysicalEmissionSourceOrigin, { readonly kind: "construction" }>;
type Module = { readonly module: RustModuleErrorInitializer; readonly initializers: readonly RustInitializerSelection[] };
type ConstructionState =
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "open"; readonly boundaries: readonly SourceStorageDomainBoundary[] };
type ConstructionStatus = ConstructionState & {
  readonly invocation: Node;
  readonly root: Node;
  readonly owner: Node | undefined;
  readonly region: Node | undefined;
};
type ConstructionRootSelection =
  | { readonly kind: "complete"; readonly roots: readonly Node[] }
  | { readonly kind: "open"; readonly roots: readonly Node[]; readonly boundaries: readonly SourceStorageDomainBoundary[] }
  | { readonly kind: "unavailable"; readonly roots: readonly Node[]; readonly reason: string;
      readonly boundaries: readonly SourceStorageDomainBoundary[] };
type ConstructionTraceState = {
  readonly boundaries: readonly SourceStorageDomainBoundary[];
  readonly failure: string | undefined;
};

const unavailable = (reason: string, alternatives: readonly RustPhysicalEmissionSourceOrigin[] = [],
  boundaries: readonly SourceStorageDomainBoundary[] = []): Origins =>
  Object.freeze({ kind: "unavailable", reason, alternatives: Object.freeze(alternatives), boundaries: Object.freeze(boundaries) });
const sourceBindings = (origin: RustPhysicalEmissionSourceOrigin): SourceStorageBindings =>
  origin.kind === "module" || origin.kind === "construction" ? origin.selection.bindings : origin.activation.bindings;

export function createRustEmissionSourceOriginPreparation(input: RustEmissionSourceInput,
  requests: readonly RustEmissionSourceRequest[]):
  (request: RustEmissionSourceRequest, occurrence: RustPhysicalEmissionSourceOccurrence) => RustPhysicalEmissionSourceOrigins {
  const storage = input.sourceStorage;
  const members = new Map<object, Node>();
  for (const definition of input.physical.definitions()) for (const member of definition.members)
    members.set(member, member.implementation.declaration);
  const producers = new Map<Node, { readonly selection: Exclude<RustPhysicalCallableSourceSelection, { readonly kind: "unresolved" }>;
    readonly row: RustPhysicalCallableSourceProducer }[]>();
  const seenSources = new Set<RustPhysicalCallableSourceSelection>();
  for (const demand of input.emissionRequests) {
    if (demand.kind === "type" || demand.kind === "producer") continue;
    const selected = demand.kind === "value" ? input.nativeStorage.valueFor(demand.subject)
      : demand.kind === "operand" ? input.nativeStorage.operandFor(demand.subject)
      : demand.kind === "return" ? input.nativeStorage.returnFor(demand.subject)
      : input.nativeStorage.invocationCallableFor(demand.subject);
    if (selected.kind === "unresolved") continue;
    if (!Array.isArray(selected.sources)) throw new Error("Physical source origins require the complete original selection source vector.");
    for (const source of selected.sources) {
      if (seenSources.has(source)) continue;
      seenSources.add(source);
      if (source.kind === "unresolved") continue;
      for (const row of source.producers) {
        const declaration = members.get(row.member);
        if (declaration === undefined || declaration !== row.producer.subject.node) continue;
        const selected = producers.get(declaration) ?? [];
        selected.push({ selection: source, row });
        producers.set(declaration, selected);
      }
    }
  }
  const modules = new Map<Node, Module>();
  for (const initializer of [input.initialization.root, ...input.initialization.workers.map(worker => worker.initializer)]) {
    for (const module of initializer.modules) {
      if (input.initialization.moduleFor(module.sourceFile) !== module)
        throw new Error("Source initialization requires its original selected module descriptor.");
      const previous = modules.get(module.sourceFile);
      if (previous !== undefined && previous.module !== module)
        throw new Error("One authored source module requires one original initializer descriptor.");
      if (previous === undefined) modules.set(module.sourceFile, { module, initializers: Object.freeze([initializer]) });
      else if (!previous.initializers.includes(initializer))
        modules.set(module.sourceFile, { module, initializers: Object.freeze([...previous.initializers, initializer]) });
    }
  }
  const declarations = new Map<Node, RustEmissionSourceRequest[]>();
  for (const request of requests) {
    if (request.demands.length === 0 || request.source.kind !== "declaration" && request.source.kind !== "callable") continue;
    const selected = declarations.get(request.declaration) ?? [];
    selected.push(request);
    declarations.set(request.declaration, selected);
  }
  const nativeRows = (declaration: Node, bindings: SourceStorageBindings) => {
    const selected = input.genericBindingsFor(declaration, bindings);
    return selected.kind === "unresolved" ? selected : selected.sourceActivations;
  };
  const declarationOrigins = (request: RustEmissionSourceRequest): Origins => {
    const bindings = storage.bindingsForDeclaration(request.declaration);
    if (bindings.kind === "unresolved") return unavailable(bindings.reason);
    const selected = nativeRows(request.declaration, bindings.bindings);
    if (selected.kind === "unresolved") return unavailable(selected.reason);
    const alternatives: RustPhysicalEmissionSourceOrigin[] = [];
    let failure: string | undefined;
    for (const row of selected.rows) {
      if (row.activation.declaration !== request.declaration || row.activation.kind !== "declaration") {
        failure ??= "A native declaration source requires its identical selected declaration activation.";
        continue;
      }
      alternatives.push(Object.freeze({ kind: "declaration", activation: row.activation, targetBindings: row.targetBindings }));
    }
    if (failure !== undefined) return unavailable(failure, alternatives);
    return alternatives.length === 0 ? unavailable("A native declaration source has no owning activation.")
      : Object.freeze({ kind: "resolved", alternatives: Object.freeze(alternatives) });
  };
  const callableOrigins = (request: RustEmissionSourceRequest, subject: SourceStorageSubject): Origins => {
    if (request.source.kind !== "callable") return unavailable("A callable source requires its original selected implementation.");
    const selected = (producers.get(request.source.implementation) ?? [])
      .filter(entry => request.source.kind === "callable" && (request.source.member === undefined || entry.row.member === request.source.member));
    if (selected.length === 0) return unavailable("A callable source has no original producer-to-admitted-member correspondence.");
    const alternatives: RustPhysicalEmissionSourceOrigin[] = [];
    const boundaries: SourceStorageDomainBoundary[] = [];
    let failure: string | undefined;
    for (const entry of selected) {
      if (entry.selection.kind === "open") boundaries.push(...entry.selection.boundaries);
      const executions = storage.contributingExecutionsFor(subject, request.declaration, entry.row.producer);
      if (executions.kind === "unresolved") { failure ??= executions.reason; continue; }
      if (executions.kind === "open") boundaries.push(...executions.boundaries);
      for (const execution of executions.producers) {
        const activations = nativeRows(request.declaration, execution.bindings);
        if (activations.kind === "unresolved") { failure ??= activations.reason; continue; }
        for (const row of activations.rows) {
          if (row.activation.declaration !== request.declaration) {
            failure ??= "A callable source activation belongs to a different original body owner.";
            continue;
          }
          alternatives.push(Object.freeze({ kind: "callable", producer: entry.row.producer, member: entry.row.member,
            execution, activation: row.activation, targetBindings: row.targetBindings }));
        }
      }
    }
    if (failure !== undefined) return unavailable(failure, alternatives, boundaries);
    return boundaries.length === 0 ? Object.freeze({ kind: "resolved", alternatives: Object.freeze(alternatives) })
      : Object.freeze({ kind: "open", alternatives: Object.freeze(alternatives), boundaries: Object.freeze(boundaries) });
  };
  const moduleOrigins = (module: Module, subject: SourceStorageSubject, targetBindings: RustTargetGenericBindings): Origins => {
    if (storage.source.ast.getSourceFile(subject.node) !== module.module.sourceFile ||
      module.initializers.some(initializer => !initializer.modules.includes(module.module)))
      return unavailable("A module source occurrence requires its exact selected initializer/module membership.");
    const region = storage.enclosingRegionFor(subject.node);
    if (region === undefined) return unavailable("An authored module source occurrence has no checked execution region.");
    const selection = storage.bindingsForLexicalOwner(subject.node);
    if (selection.kind === "unresolved") return unavailable(selection.reason);
    return Object.freeze({ kind: "resolved", alternatives: Object.freeze(module.initializers.map(initializer => Object.freeze({
      kind: "module" as const, sourceFile: module.module.sourceFile, initializer, module: module.module,
      region, selection, targetBindings }))) });
  };
  const callerOrigins = (demand: RustPhysicalCallableEmissionRequest, subject: SourceStorageSubject): Origins => {
    const module = modules.get(demand.owner);
    if (module !== undefined) return moduleOrigins(module, subject, demand.bindings);
    const alternatives: RustPhysicalEmissionSourceOrigin[] = [];
    const boundaries: SourceStorageDomainBoundary[] = [];
    let failure: string | undefined;
    for (const request of declarations.get(demand.owner) ?? []) {
      if (!request.demands.includes(demand)) continue;
      const selected = request.source.kind === "declaration" ? declarationOrigins(request) : callableOrigins(request, subject);
      alternatives.push(...selected.alternatives);
      if (selected.kind !== "resolved") boundaries.push(...selected.boundaries);
      if (selected.kind === "unavailable") failure ??= selected.reason;
    }
    if (failure !== undefined) return unavailable(failure, alternatives, boundaries);
    return boundaries.length === 0 ? Object.freeze({ kind: "resolved", alternatives: Object.freeze(alternatives) })
      : Object.freeze({ kind: "open", alternatives: Object.freeze(alternatives), boundaries: Object.freeze(boundaries) });
  };
  let constructions: readonly ConstructionOrigin[] | undefined;
  const constructionStatuses: ConstructionStatus[] = [];
  const constructionRoots = new Set(requests.flatMap(request => request.source.kind === "construction"
    ? [request.source.plan.definition.declaration] : []));
  const invocationRoots = (demand: RustPhysicalCallableEmissionRequest, caller: RustPhysicalEmissionSourceOrigin | undefined,
    root: Construction | undefined): ConstructionRootSelection => {
    if (root !== undefined && !storage.source.ast.is.IsNewExpression(demand.subject))
      return { kind: "complete", roots: [root.root] };
    const checked = storage.source.semantics.forNode(demand.subject).operations.call(demand.subject);
    if (checked === undefined) return { kind: "unavailable", roots: [], boundaries: [],
      reason: "A source construction requires its original checked invocation." };
    const bindings = caller === undefined ? storage.bindingsForLexicalOwner(demand.subject)
      : { kind: "resolved" as const, bindings: sourceBindings(caller) };
    if (bindings.kind === "unresolved") return { kind: "unavailable", roots: [], boundaries: [], reason: bindings.reason };
    const subject = storage.subjectFor(checked.sourceCallee.expression);
    if (subject.kind === "unresolved") return { kind: "unavailable", roots: [], boundaries: [], reason: subject.reason };
    const selected = storage.storageProducersFor(subject.subject, bindings.bindings);
    if (selected.kind === "unresolved") return { kind: "unavailable", roots: [], boundaries: [], reason: selected.reason };
    const roots: Node[] = [];
    let unavailableRoot = selected.producers.length === 0;
    for (const producer of selected.producers) {
      if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0 ||
        !constructionRoots.has(producer.subject.node)) {
        unavailableRoot = true;
        continue;
      }
      roots.push(producer.subject.node);
    }
    const boundaries = selected.kind === "open" ? selected.boundaries : [];
    if (unavailableRoot) return { kind: "unavailable", roots, boundaries,
      reason: "A source construction domain contains no emitted original root for at least one actual producer." };
    return selected.kind === "open" ? { kind: "open", roots, boundaries } : { kind: "complete", roots };
  };
  const invocationStatus = (demand: RustPhysicalCallableEmissionRequest, caller: RustPhysicalEmissionSourceOrigin | undefined,
    root: Construction | undefined, state: ConstructionState): void => {
    const selected = invocationRoots(demand, caller, root);
    const boundaries = selected.kind === "complete" ? [] : selected.boundaries;
    for (const root of selected.roots) {
      constructionStatuses.push({ ...state, invocation: demand.subject, root, owner: undefined, region: undefined });
      if (boundaries.length !== 0) constructionStatuses.push({ kind: "open", invocation: demand.subject,
        root, owner: undefined, region: undefined, boundaries });
      if (selected.kind === "unavailable" && state.kind !== "unavailable") constructionStatuses.push({ kind: "unavailable",
        invocation: demand.subject, root, owner: undefined, region: undefined, reason: selected.reason });
    }
  };
  const constructionOrigins = (request: RustEmissionSourceRequest, subject: SourceStorageSubject): Origins => {
    const source = request.source;
    if (source.kind !== "construction" || source.layer === undefined)
      return unavailable("An authored constructor occurrence requires its exact selected native layer.");
    const layer = source.layer;
    if (constructions === undefined) {
      const calls = new Map<Node, RustPhysicalCallableEmissionRequest>();
      const byOwner = new Map<Node, RustPhysicalCallableEmissionRequest[]>();
      for (const demand of input.emissionRequests) {
        if (demand.kind === "type" || demand.kind === "producer" || calls.has(demand.subject)) continue;
        const operation = input.records.targetOperation.get(demand.subject);
        if (operation?.kind !== "source-call" || operation.target.form !== "constructor" && operation.target.form !== "constructor-value") continue;
        calls.set(demand.subject, demand);
        const selected = byOwner.get(demand.owner) ?? [];
        selected.push(demand);
        byOwner.set(demand.owner, selected);
      }
      const pending: { readonly demand: RustPhysicalCallableEmissionRequest; readonly caller: RustPhysicalEmissionSourceOrigin;
        readonly root: Construction | undefined; readonly state: ConstructionTraceState }[] = [];
      for (const demand of calls.values()) {
        const selected = storage.subjectFor(demand.subject);
        if (selected.kind === "unresolved") {
          invocationStatus(demand, undefined, undefined, { kind: "unavailable", reason: selected.reason });
          continue;
        }
        const origins = callerOrigins(demand, selected.subject);
        if (origins.kind === "unavailable") invocationStatus(demand, undefined, undefined, { kind: "unavailable", reason: origins.reason });
        const boundaries = origins.kind === "resolved" ? [] : origins.boundaries;
        if (boundaries.length !== 0) invocationStatus(demand, undefined, undefined, { kind: "open", boundaries });
        const state = Object.freeze({ boundaries, failure: origins.kind === "unavailable" ? origins.reason : undefined });
        for (const caller of origins.alternatives) pending.push({ demand, caller, root: undefined, state });
      }
      const rows: ConstructionOrigin[] = [];
      const routed = new Map<Node, Map<SourceStorageBindings, Map<Construction, Set<ConstructionTraceState>>>>();
      for (let index = 0; index < pending.length; index += 1) {
        const entry = pending[index]!;
        const callerBindings = sourceBindings(entry.caller);
        const selected = storage.constructionFor(entry.demand.subject, callerBindings);
        if (selected.kind === "unresolved") {
          invocationStatus(entry.demand, entry.caller, entry.root, { kind: "unavailable", reason: selected.reason });
          continue;
        }
        for (const construction of selected.alternatives) {
          const root = construction.allocation === entry.demand.subject ? construction : entry.root ?? construction;
          const bindingsByCall = routed.get(entry.demand.subject) ?? new Map<SourceStorageBindings,
            Map<Construction, Set<ConstructionTraceState>>>();
          const roots = bindingsByCall.get(callerBindings) ?? new Map<Construction, Set<ConstructionTraceState>>();
          const states = roots.get(root) ?? new Set<ConstructionTraceState>();
          const descend = !states.has(entry.state);
          states.add(entry.state);
          roots.set(root, states);
          bindingsByCall.set(callerBindings, roots);
          routed.set(entry.demand.subject, bindingsByCall);
          const region = (owner: Node, node: Node, selection: Bindings): void => {
            if (entry.state.failure !== undefined) constructionStatuses.push({ kind: "unavailable", invocation: entry.demand.subject,
              root: root.root, owner, region: node, reason: entry.state.failure });
            if (entry.state.boundaries.length !== 0) constructionStatuses.push({ kind: "open", invocation: entry.demand.subject,
              root: root.root, owner, region: node, boundaries: entry.state.boundaries });
            const activations = nativeRows(owner, selection.bindings);
            if (activations.kind === "unresolved") {
              constructionStatuses.push({ kind: "unavailable", invocation: entry.demand.subject, root: root.root, owner,
                region: node, reason: activations.reason });
              return;
            }
            if (activations.rows.length === 0) constructionStatuses.push({ kind: "unavailable", invocation: entry.demand.subject,
              root: root.root, owner, region: node, reason: "A constructor region lost its exact owning activation and native binding row." });
            for (const target of activations.rows) {
              if (target.activation.declaration !== owner) {
                constructionStatuses.push({ kind: "unavailable", invocation: entry.demand.subject, root: root.root, owner,
                  region: node, reason: "A constructor region lost its exact owning activation and native binding row." });
                continue;
              }
              const origin: ConstructionOrigin = Object.freeze({ kind: "construction", invocation: entry.demand.subject,
                construction, root, callerBindings, caller: entry.caller, owner, region: node, selection,
                activation: target.activation, targetBindings: target.targetBindings });
              rows.push(origin);
              if (descend) for (const demand of byOwner.get(owner) ?? [])
                if (storage.enclosingRegionFor(demand.subject) === node) pending.push({ demand, caller: origin, root,
                  state: entry.state });
            }
          };
          const implementation = construction.implementation;
          if (implementation !== undefined) for (const node of implementation.regions)
            region(implementation.declaration, node, implementation.selection);
          for (const selectedClass of construction.classes) for (const selectedRegion of selectedClass.regions)
            region(selectedClass.owner, selectedRegion.node, selectedRegion.selection);
        }
      }
      constructions = Object.freeze(rows);
    }
    const region = storage.enclosingRegionFor(subject.node);
    const owner = layer.constructor ?? layer.definition.declaration;
    if (region === undefined || !source.plan.layers.includes(layer) || request.declaration !== owner ||
      !request.demands.some(demand => demand.subject === subject.node &&
        (demand.owner === owner || demand.owner === layer.definition.declaration)))
      return unavailable("An authored constructor occurrence requires its identical selected layer and original emitted demand owner.");
    const alternatives = constructions.filter(origin => origin.root.root === source.plan.definition.declaration &&
      (origin.owner === owner || origin.owner === layer.definition.declaration) && origin.region === region);
    const statuses = constructionStatuses.filter(status => status.root === source.plan.definition.declaration &&
      (status.owner === undefined || status.owner === owner || status.owner === layer.definition.declaration) &&
      (status.region === undefined || status.region === region));
    const failure = statuses.find(status => status.kind === "unavailable");
    const boundaries = statuses.flatMap(status => status.kind === "open" ? status.boundaries : []);
    if (failure?.kind === "unavailable") return unavailable(failure.reason, alternatives, boundaries);
    if (alternatives.length === 0 && boundaries.length === 0)
      return unavailable("An authored constructor occurrence has no original checked construction/region selection.");
    return boundaries.length === 0 ? Object.freeze({ kind: "resolved", alternatives: Object.freeze(alternatives) })
      : Object.freeze({ kind: "open", alternatives: Object.freeze(alternatives), boundaries: Object.freeze(boundaries) });
  };
  return (request, occurrence) => {
    const selected = storage.subjectFor(occurrence.node);
    if (selected.kind === "unresolved") return Object.freeze({ ...unavailable(selected.reason), use: request.use, occurrence });
    const subject = selected.subject;
    const source = request.source;
    const origins = source.kind === "declaration" ? declarationOrigins(request)
      : source.kind === "callable" ? callableOrigins(request, subject)
      : source.kind === "construction" ? constructionOrigins(request, subject)
      : source.kind === "module" ? moduleOrigins(source, subject, request.bindings)
      : unavailable("A generated worker wrapper has no authored source execution occurrence.");
    return origins.kind === "unavailable" ? Object.freeze({ ...origins, use: request.use, occurrence })
      : Object.freeze({ ...origins, use: request.use, occurrence, subject });
  };
}
