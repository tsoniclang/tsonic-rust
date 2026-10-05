import type { RustTargetConstArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { inferRustTargetGenericBindings, rustCallableProtocol, rustOptionElementCarrier,
  rustStructuralObjectCarrierValue, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimesEqual, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { RustTargetGenericBindings, RustTargetGenericParameterSet } from "../../target-model/types/carriers/generic-inference.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceObjectShape } from "../project-types/source-type-registry.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { callableRestElement, selectRustCallableValueAdapter } from "../callables/adapters.js";
import { selectRustProjectStructuralViewFields, selectRustProjectStructuralViewSources,
  type RustProjectStructuralView, type RustProjectStructuralViewSource } from "./project-structural-views.js";
import { rustProjectViewMatches } from "./view-implementations.js";

interface RustStructuralViewBindings extends RustTargetGenericBindings {
  readonly types: Map<string, TargetTypeRef>;
  readonly lifetimes: Map<string, RustLifetimeRef>;
  readonly consts: Map<string, RustTargetConstArgument>;
}

export function generalizeRustProjectStructuralView(
  view: RustProjectStructuralView, target: RustSourceObjectShape, walk: RustFactWalk,
  selectedSources: readonly RustProjectStructuralViewSource[],
): RustProjectStructuralView | undefined {
  const projectTypes = walk.context.projectTypes;
  const definition = projectTypes.definitionForDeclaration(view.declaration);
  if (definition === undefined || !rustTargetTypeRefEquals(view.targetCarrier, target.carrier)) return undefined;
  if (!projectTypes.isPolymorphic(definition)) return view;
  const sourceCarrier = projectTypes.openCarrier(definition);
  if (rustTargetTypeRefEquals(sourceCarrier, view.sourceCarrier)) return view;
  const sourceParameters = rustTargetGenericReferences(sourceCarrier);
  const sourceBindings = inferRustTargetGenericBindings(sourceCarrier, view.sourceCarrier, {
    typeIdentities: new Set(sourceParameters.typeIdentities), lifetimeIdentities: new Set(sourceParameters.lifetimeIdentities),
    constIdentities: new Set(sourceParameters.constIdentities),
  });
  if (sourceBindings === undefined || sourceBindings.types.size !== sourceParameters.typeIdentities.length ||
    sourceBindings.lifetimes.size !== sourceParameters.lifetimeIdentities.length ||
    sourceBindings.consts.size !== sourceParameters.constIdentities.length) return undefined;
  const specialize = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(
    carrier, sourceBindings.types, sourceBindings.lifetimes, sourceBindings.consts);
  if (!rustTargetTypeRefEquals(specialize(sourceCarrier), view.sourceCarrier)) return undefined;
  const template = structuralViewTemplate(target.carrier, walk);
  const shape = rustStructuralObjectCarrierValue(template);
  const semantics = walk.context.semanticsFor(view.declaration);
  const sourceType = semantics.declarations.declaredType(view.declaration);
  if (template === undefined || shape === undefined || sourceType === undefined || shape.fields.length !== view.fields.length) return undefined;
  const sources = selectRustProjectStructuralViewSources(walk, sourceCarrier, target, semantics, sourceType);
  if (sources === undefined || sources.length !== view.fields.length) return undefined;
  const closedFields = selectRustProjectStructuralViewFields(selectedSources, target, walk);
  if (closedFields === undefined || closedFields.length !== view.fields.length ||
    !closedFields.every((field, index) => structuralViewMemberMatches(field, view.fields[index]))) return undefined;
  const parameters = rustTargetGenericReferences(template);
  const parameterSet: RustTargetGenericParameterSet = {
    typeIdentities: new Set(parameters.typeIdentities), lifetimeIdentities: new Set(parameters.lifetimeIdentities),
    constIdentities: new Set(parameters.constIdentities),
  };
  const bindings: RustStructuralViewBindings = {
    types: new Map(), lifetimes: new Map(), consts: new Map(),
  };
  const collect = (pattern: TargetTypeRef, actual: TargetTypeRef, adapter?: RustCallableValueAdapter, parameter = false): boolean =>
    collectStructuralViewBindings(pattern, actual, adapter, parameter, parameterSet, bindings, walk);
  for (const [index, source] of sources.entries()) {
    const selected = view.fields[index];
    const required = shape.fields[source.storageIndex];
    const destination = target.fields.find(field => field.storageIndex === source.storageIndex);
    if (selected === undefined || required === undefined || destination === undefined ||
      selected.declaration !== source.declaration || selected.storageIndex !== source.storageIndex) return undefined;
    if (source.kind === "method") {
      if (selected.callable === undefined || selected.field !== undefined || selected.accessor !== undefined || selected.readAdapter !== undefined) return undefined;
      const protocol = rustCallableProtocol(required.type);
      const implementation = source.callable.parameterAdapters.map(adapter => adapter.target);
      if (protocol === undefined || selected.callable.parameterAdapters.length !== implementation.length ||
        !collect(protocol.result, source.callable.resultAdapter.sourceCarrier, selected.callable.resultAdapter) ||
        !selected.callable.parameterAdapters.every((adapter, parameterIndex) => collectStructuralParameterBindings(
          protocol.parameters, implementation[parameterIndex]!, adapter, collect))) return undefined;
    } else {
      if (selected.callable !== undefined || selected.readAdapter === undefined ||
        source.kind === "field" && (selected.field?.declaration !== source.declaration || selected.accessor !== undefined ||
          !rustTargetTypeRefEquals(selected.field.receiverCarrier, view.sourceCarrier) ||
          !rustTargetTypeRefEquals(selected.field.resultCarrier, specialize(source.carrier))) ||
        source.kind === "accessor" && (selected.field !== undefined || selected.accessor?.read?.declaration !== source.accessor.read?.declaration ||
          selected.accessor?.write?.declaration !== source.accessor.write?.declaration ||
          !rustTargetTypeRefEquals(selected.accessor?.read?.resultCarrier, specialize(source.carrier)))) return undefined;
      if (!collect(required.type, source.carrier, selected.readAdapter)) return undefined;
    }
  }
  for (const base of shape.bases) {
    const owner = projectTypes.definitionForCarrier(base);
    const relationship = owner === undefined ? undefined : projectTypes.relationship(sourceCarrier, owner);
    if (relationship?.kind !== "related" || !collect(base, relationship.targetType)) return undefined;
  }
  if (bindings.types.size !== parameters.typeIdentities.length || bindings.lifetimes.size !== parameters.lifetimeIdentities.length ||
    bindings.consts.size !== parameters.constIdentities.length) return undefined;
  const targetCarrier = substituteRustTargetGenerics(template, bindings.types, bindings.lifetimes, bindings.consts);
  if (!rustProjectViewMatches({ sourceCarrier, targetCarrier }, view.sourceCarrier, view.targetCarrier)) return undefined;
  const generalizedShape = rustStructuralObjectCarrierValue(targetCarrier);
  if (generalizedShape === undefined) return undefined;
  const fields: RustSourceObjectShape["fields"][number][] = [];
  for (const field of target.fields) {
    const selected = generalizedShape.fields[field.storageIndex];
    if (selected === undefined) return undefined;
    fields.push({ ...field, resultCarrier: selected.type });
  }
  const selectedFields = selectRustProjectStructuralViewFields(sources,
    { ...target, carrier: targetCarrier, fields }, walk);
  return selectedFields === undefined ? undefined
    : { declaration: view.declaration, sourceCarrier, targetCarrier, fields: selectedFields };
}

function structuralViewMemberMatches(
  expected: RustProjectStructuralView["fields"][number], selected: RustProjectStructuralView["fields"][number] | undefined,
): boolean {
  if (selected === undefined || expected.declaration !== selected.declaration || expected.storageIndex !== selected.storageIndex ||
    !closedMetadataEquals(expected.readAdapter, selected.readAdapter)) return false;
  if (expected.callable !== undefined || selected.callable !== undefined) {
    if (expected.callable === undefined || selected.callable === undefined) return false;
    const { declaration: expectedDeclaration, ...expectedMetadata } = expected.callable;
    const { declaration: selectedDeclaration, ...selectedMetadata } = selected.callable;
    if (expectedDeclaration !== selectedDeclaration || !closedMetadataEquals(expectedMetadata, selectedMetadata)) return false;
  }
  if (expected.field !== undefined || selected.field !== undefined) {
    if (expected.field === undefined || selected.field === undefined) return false;
    const { declaration: expectedDeclaration, ...expectedMetadata } = expected.field;
    const { declaration: selectedDeclaration, ...selectedMetadata } = selected.field;
    if (expectedDeclaration !== selectedDeclaration || !closedMetadataEquals(expectedMetadata, selectedMetadata)) return false;
  }
  if (expected.accessor !== undefined || selected.accessor !== undefined) {
    if (expected.accessor === undefined || selected.accessor === undefined) return false;
    const accessorMetadata = (accessor: NonNullable<typeof expected.accessor>) => {
      const { read, write, ...metadata } = accessor;
      const { declaration: readDeclaration, ...readMetadata } = read ?? {};
      const { declaration: writeDeclaration, ...writeMetadata } = write ?? {};
      return { readDeclaration, writeDeclaration, metadata: { ...metadata,
        ...(read === undefined ? {} : { read: readMetadata }), ...(write === undefined ? {} : { write: writeMetadata }) } };
    };
    const expectedAccessor = accessorMetadata(expected.accessor);
    const selectedAccessor = accessorMetadata(selected.accessor);
    if (expectedAccessor.readDeclaration !== selectedAccessor.readDeclaration || expectedAccessor.writeDeclaration !== selectedAccessor.writeDeclaration ||
      !closedMetadataEquals(expectedAccessor.metadata, selectedAccessor.metadata)) return false;
  }
  return true;
}

function structuralViewTemplate(carrier: TargetTypeRef, walk: RustFactWalk): TargetTypeRef | undefined {
  const visited: TargetTypeRef[] = [];
  const instantiations = walk.sourceTypes.structuralInstantiations();
  for (;;) {
    if (visited.some(previous => rustTargetTypeRefEquals(previous, carrier))) return undefined;
    visited.push(carrier);
    const parents = instantiations.filter(entry => rustTargetTypeRefEquals(entry.instance, carrier) &&
      !rustTargetTypeRefEquals(entry.template, carrier));
    if (parents.length === 0) return carrier;
    if (parents.some(entry => !rustTargetTypeRefEquals(entry.template, parents[0]!.template))) return undefined;
    carrier = parents[0]!.template;
  }
}

function collectStructuralViewBindings(
  pattern: TargetTypeRef, actual: TargetTypeRef, adapter: RustCallableValueAdapter | undefined, parameter: boolean,
  parameters: RustTargetGenericParameterSet, bindings: RustStructuralViewBindings, walk: RustFactWalk,
): boolean {
  const references = rustTargetGenericReferences(pattern);
  if (!references.typeIdentities.some(identity => parameters.typeIdentities.has(identity)) &&
    !references.lifetimeIdentities.some(identity => parameters.lifetimeIdentities.has(identity)) &&
    !references.constIdentities.some(identity => parameters.constIdentities.has(identity))) return true;
  if (adapter?.kind === "option-some" || adapter?.kind === "option-map") {
    const elementPattern = adapter.kind === "option-map" || !parameter ? rustOptionElementCarrier(pattern) : pattern;
    const elementActual = adapter.kind === "option-map" || parameter ? rustOptionElementCarrier(actual) : actual;
    return elementPattern !== undefined && elementActual !== undefined && collectStructuralViewBindings(
      elementPattern, elementActual, adapter.element, parameter, parameters, bindings, walk);
  }
  if (adapter?.kind === "conversion" && adapter.conversion.kind === "callable-adapter") {
    const expected = rustCallableProtocol(pattern);
    const provided = rustCallableProtocol(actual);
    const source = rustCallableProtocol(adapter.conversion.source);
    const target = rustCallableProtocol(adapter.conversion.target);
    if (expected === undefined || provided === undefined || source === undefined || target === undefined) return false;
    const collect = (expected: TargetTypeRef, provided: TargetTypeRef, source: TargetTypeRef, target: TargetTypeRef, parameter: boolean): boolean => {
      const selected = selectRustCallableValueAdapter(source, target, walk.context.projectTypes, walk.context.typeDefinitions);
      return selected !== undefined && collectStructuralViewBindings(expected, provided, selected, parameter, parameters, bindings, walk);
    };
    for (const [index] of adapter.conversion.parameters.entries()) {
      const expectedParameter = expected.parameters[index];
      const providedParameter = provided.parameters[index];
      const sourceParameter = source.parameters[index];
      const targetParameter = target.parameters[index];
      if (expectedParameter === undefined || providedParameter === undefined || sourceParameter === undefined || targetParameter === undefined ||
        !collect(expectedParameter, providedParameter, targetParameter, sourceParameter, !parameter)) return false;
    }
    return adapter.conversion.result.kind === "absence" || adapter.conversion.result.kind === "discard" ||
      collect(expected.result, provided.result, source.result, target.result, parameter);
  }
  if (adapter?.kind === "project-upcast" || adapter?.kind === "conversion" && adapter.upcast !== undefined) {
    const owner = walk.context.projectTypes.definitionForCarrier(parameter ? actual : pattern);
    const relationship = owner === undefined ? undefined : walk.context.projectTypes.relationship(parameter ? pattern : actual, owner);
    if (relationship?.kind !== "related") return false;
    if (parameter) pattern = relationship.targetType;
    else actual = relationship.targetType;
  }
  const inferred = inferRustTargetGenericBindings(pattern, actual, parameters);
  if (inferred === undefined) return false;
  for (const [identity, value] of inferred.types) {
    const previous = bindings.types.get(identity);
    if (previous !== undefined && !rustTargetTypeRefEquals(previous, value)) return false;
    bindings.types.set(identity, value);
  }
  for (const [identity, value] of inferred.lifetimes) {
    const previous = bindings.lifetimes.get(identity);
    if (previous !== undefined && !rustLifetimesEqual(previous, value)) return false;
    bindings.lifetimes.set(identity, value);
  }
  for (const [identity, value] of inferred.consts) {
    const previous = bindings.consts.get(identity);
    if (previous !== undefined && !rustTargetGenericArgumentEquals({ kind: "const", value: previous }, { kind: "const", value })) return false;
    bindings.consts.set(identity, value);
  }
  return true;
}

function collectStructuralParameterBindings(
  parameters: readonly TargetTypeRef[], implementation: RustCallableParameterAbi, adapter: RustCallableParameterAdapter,
  collect: (pattern: TargetTypeRef, actual: TargetTypeRef, value: RustCallableValueAdapter, parameter: boolean) => boolean,
): boolean {
  const logical = implementation.form === "optional" ? rustOptionElementCarrier(implementation.parameterCarrier) : implementation.valueCarrier;
  switch (adapter.kind) {
    case "omitted": return true;
    case "runtime-value": {
      const pattern = parameters[adapter.contractParameterIndex];
      return pattern !== undefined && collect(pattern, implementation.parameterCarrier, adapter.adapter, true);
    }
    case "logical-value": {
      const pattern = parameters[adapter.contractParameterIndex];
      return pattern !== undefined && logical !== undefined && collect(pattern, logical, adapter.adapter, true);
    }
    case "rest-element": {
      const parameter = parameters[adapter.contractParameterIndex];
      const pattern = parameter === undefined ? undefined : callableRestElement(parameter);
      return pattern !== undefined && logical !== undefined && collect(pattern, logical, adapter.adapter, true);
    }
    case "rest": {
      const actual = callableRestElement(implementation.parameterCarrier);
      return actual !== undefined && adapter.segments.every(segment => {
        const parameter = parameters[segment.contractParameterIndex];
        const pattern = parameter === undefined ? undefined : segment.kind === "sequence" ? callableRestElement(parameter) : parameter;
        return pattern !== undefined && collect(pattern, actual, segment.adapter, true);
      });
    }
  }
}
