import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageConstructionSelection, SourceStorageDomainBoundary, SourceStorageSubject, SourceStorageQueries, TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustInitializationErrorRecords, RustInitializerSelection, RustModuleErrorInitializer } from "../../../target-model/records/errors/error-regions.js";
import type { RustPhysicalCallableSourceProducer, RustPhysicalCallableSourceSelection, RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigin, RustPhysicalEmissionSourceOrigins } from "../../../target-model/records/native/physical-emission-contexts.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustProjectConstructionPlan } from "../../project-types/construction-plan.js";
import type { RustConstructionLayer } from "../../../target-model/records/objects/construction.js";
import type { RustGenericCallablePhysicalPlan } from "../../../target-model/records/callables/generic-callables.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import type { RustPhysicalCallableEmissionRequest } from "../ownership/physical-lifecycle.js";
import type { RustPhysicalCallableStorage } from "../../../target-model/records/native/native-storage.js";

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
  | { readonly kind: "unavailable"; readonly reason: string };

type Construction = Extract<SourceStorageConstructionSelection, { readonly kind: "resolved" }>["alternatives"][number];
type Bindings = Extract<SourceStorageBindingsSelection, { readonly kind: "resolved" }>;
type ConstructionOrigin = Extract<RustPhysicalEmissionSourceOrigin, { readonly kind: "construction" }>;
type Module = { readonly module: RustModuleErrorInitializer; readonly initializers: readonly RustInitializerSelection[] };

const unavailable = (reason: string): Origins => Object.freeze({ kind: "unavailable", reason });
const sourceBindings = (origin: RustPhysicalEmissionSourceOrigin): SourceStorageBindings =>
  origin.kind === "module" ? origin.selection.bindings : origin.activation.bindings;

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
    if (!Array.isArray(selected.sources)) failTargetAnalysisInvariant("tsonic-rust", "Physical source origins require the complete original selection source vector.");
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
        failTargetAnalysisInvariant("tsonic-rust", "Source initialization requires its original selected module descriptor.");
      const previous = modules.get(module.sourceFile);
      if (previous !== undefined && previous.module !== module)
        failTargetAnalysisInvariant("tsonic-rust", "One authored source module requires one original initializer descriptor.");
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
    const bindings = storage.bindingsForLexicalOwner(request.declaration);
    if (bindings.kind === "unresolved") return unavailable(bindings.reason);
    const selected = nativeRows(request.declaration, bindings.bindings);
    if (selected.kind === "unresolved") return unavailable(selected.reason);
    const alternatives: RustPhysicalEmissionSourceOrigin[] = [];
    for (const row of selected.rows) {
      if (row.activation.declaration !== request.declaration || row.activation.kind !== "declaration")
        return unavailable("A native declaration source requires its identical selected declaration activation.");
      alternatives.push(Object.freeze({ kind: "declaration", activation: row.activation, targetBindings: row.targetBindings }));
    }
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
    for (const entry of selected) {
      if (entry.selection.kind === "open") boundaries.push(...entry.selection.boundaries);
      const executions = storage.contributingExecutionsFor(subject, request.declaration, entry.row.producer);
      if (executions.kind === "unresolved") return unavailable(executions.reason);
      if (executions.kind === "open") boundaries.push(...executions.boundaries);
      for (const execution of executions.producers) {
        const activations = nativeRows(request.declaration, execution.bindings);
        if (activations.kind === "unresolved") return unavailable(activations.reason);
        for (const row of activations.rows) {
          if (row.activation.declaration !== request.declaration)
            return unavailable("A callable source activation belongs to a different original body owner.");
          alternatives.push(Object.freeze({ kind: "callable", producer: entry.row.producer, member: entry.row.member,
            execution, activation: row.activation, targetBindings: row.targetBindings }));
        }
      }
    }
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
    for (const request of declarations.get(demand.owner) ?? []) {
      if (!request.demands.includes(demand)) continue;
      const selected = request.source.kind === "declaration" ? declarationOrigins(request) : callableOrigins(request, subject);
      if (selected.kind === "unavailable") return selected;
      alternatives.push(...selected.alternatives);
      if (selected.kind === "open") boundaries.push(...selected.boundaries);
    }
    return boundaries.length === 0 ? Object.freeze({ kind: "resolved", alternatives: Object.freeze(alternatives) })
      : Object.freeze({ kind: "open", alternatives: Object.freeze(alternatives), boundaries: Object.freeze(boundaries) });
  };
  let constructions: readonly ConstructionOrigin[] | undefined;
  let constructionFailure: string | undefined;
  const constructionOrigins = (request: RustEmissionSourceRequest, subject: SourceStorageSubject): Origins => {
    const source = request.source;
    if (source.kind !== "construction" || source.layer === undefined)
      return unavailable("An authored constructor occurrence requires its exact selected native layer.");
    const layer = source.layer;
    if (!source.plan.layers.includes(layer) || !source.plan.layers.some(candidate => candidate.definition === source.plan.definition))
      return unavailable("An authored constructor occurrence requires its original constructor plan and layer.");
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
        readonly root: Construction | undefined }[] = [];
      for (const demand of calls.values()) {
        const selected = storage.subjectFor(demand.subject);
        if (selected.kind === "unresolved") { constructionFailure = selected.reason; continue; }
        const origins = callerOrigins(demand, selected.subject);
        if (origins.kind !== "resolved") { constructionFailure = origins.kind === "unavailable" ? origins.reason
          : "Constructor source execution retains an open caller boundary."; continue; }
        for (const caller of origins.alternatives) pending.push({ demand, caller, root: undefined });
      }
      const rows: ConstructionOrigin[] = [];
      const routed = new Map<Node, Map<SourceStorageBindings, Set<Construction>>>();
      for (let index = 0; index < pending.length; index += 1) {
        const entry = pending[index]!;
        const callerBindings = sourceBindings(entry.caller);
        const selected = storage.constructionFor(entry.demand.subject, callerBindings);
        if (selected.kind === "unresolved") { constructionFailure = selected.reason; continue; }
        for (const construction of selected.alternatives) {
          const root = construction.allocation === entry.demand.subject ? construction : entry.root ?? construction;
          const bindingsByCall = routed.get(entry.demand.subject) ?? new Map<SourceStorageBindings, Set<Construction>>();
          const roots = bindingsByCall.get(callerBindings) ?? new Set<Construction>();
          const descend = !roots.has(root);
          roots.add(root);
          bindingsByCall.set(callerBindings, roots);
          routed.set(entry.demand.subject, bindingsByCall);
          const region = (owner: Node, node: Node, selection: Bindings): void => {
            const activations = nativeRows(owner, selection.bindings);
            if (activations.kind === "unresolved") { constructionFailure = activations.reason; return; }
            if (activations.rows.length === 0 || activations.rows.some(row => row.activation.declaration !== owner)) {
              constructionFailure = "A constructor region lost its exact owning activation and native binding row.";
              return;
            }
            for (const target of activations.rows) {
              const origin: ConstructionOrigin = Object.freeze({ kind: "construction", invocation: entry.demand.subject,
                construction, root, callerBindings, caller: entry.caller, owner, region: node, selection,
                activation: target.activation, targetBindings: target.targetBindings });
              rows.push(origin);
              if (descend) for (const demand of byOwner.get(owner) ?? [])
                if (storage.enclosingRegionFor(demand.subject) === node) pending.push({ demand, caller: origin, root });
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
    const alternatives = constructions.filter(origin =>
      (layer.definition === source.plan.definition ? origin.construction.root : origin.root.root) === source.plan.definition.declaration &&
      origin.construction.allocation === origin.root.allocation &&
      (origin.owner === owner || origin.owner === layer.definition.declaration) && origin.region === region);
    if (constructionFailure !== undefined) return unavailable(constructionFailure);
    return alternatives.length === 0 ? unavailable("An authored constructor occurrence has no original checked construction/region selection.")
      : Object.freeze({ kind: "resolved", alternatives: Object.freeze(alternatives) });
  };
  return (request, occurrence) => {
    const selected = storage.subjectFor(occurrence.node);
    if (selected.kind === "unresolved") return Object.freeze({ kind: "unavailable", use: request.use, occurrence, reason: selected.reason });
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
