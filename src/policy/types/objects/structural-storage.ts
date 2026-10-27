import type { RustStructuralShapeDefinition, RustStructuralMethodPlan, RustStructuralMethodPayload } from "../../../target-model/records/objects/structural-shapes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { closedMetadataEquals, closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../target-model/types/index.js";

import { rustTargetGenericReferences, visitRustTargetTypeParameters } from "../../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters, substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustCarrierWithTargetPlaceholderLifetimes } from "../../../target-model/types/placeholder-lifetimes.js";
import { rustCallableTargetForSourceLifetime } from "../../conversions/value-carrier-reconciliation.js";

export function structuralStorageKey(carrier: TargetTypeRef, componentForFile: (fileName: string) => string): string {
  const substitutions = new Map<string, TargetTypeRef>();
  visitRustTargetTypeParameters(carrier, (parameter) => {
    if (!substitutions.has(parameter.identity)) {
      substitutions.set(parameter.identity, { kind: "type-parameter", identity: `structural-shape:${substitutions.size}`, name: `ShapeParameter${substitutions.size}` });
    }
    return false;
  });
  const normalized = substituteRustTargetTypeParameters(carrier, substitutions);
  const shape = rustStructuralObjectCarrierValue(normalized);
  return closedMetadataKey(shape === undefined ? normalized :
    rustStructuralObjectTargetType(componentForFile(shape.ownerFileName), shape.fields, shape.representation, shape.construction, shape.bases, shape.implementation));
}

export function instantiateStructuralDefinition<MethodPlan extends
  Pick<RustStructuralMethodPlan, "kind" | "carrier" | "receiver" | "constructions"> & {
    readonly payload?: RustStructuralMethodPayload; readonly context?: TargetTypeRef;
  }>(
  definition: RustStructuralShapeDefinition<MethodPlan>,
  carrier: TargetTypeRef,
): RustStructuralShapeDefinition<MethodPlan> | undefined {
  if (rustTargetTypeRefEquals(definition.carrier, carrier)) {
    return definition;
  }
  const parameters = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "type" ? [parameter.identity] : []));
  const lifetimes = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
  const shape = rustStructuralObjectCarrierValue(carrier);
  const aligned = shape === undefined ? carrier : rustStructuralObjectTargetType(definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases, shape.implementation);
  // A placeholder lifetime in a definition has no lifetime parameter of its own, so the struct stores it as 'static and
  // a 'static instance lifetime instantiates it.
  const template = rustCarrierWithTargetPlaceholderLifetimes(definition.carrier, aligned, lifetime => lifetime.kind === "static");
  const bindings = inferRustTargetGenericBindings(template, aligned, {
    typeIdentities: parameters, lifetimeIdentities: lifetimes, constIdentities: new Set(),
  });
  const substitute = (type: TargetTypeRef) => bindings === undefined ? type :
    substituteRustTargetGenerics(type, bindings.types, bindings.lifetimes, bindings.consts);
  const argument = (argument: RustStructuralShapeDefinition["genericArguments"][number]) => argument.kind === "lifetime"
    ? Object.freeze({ kind: "lifetime" as const, lifetime: bindings?.lifetimes.get(rustLifetimeKey(argument.lifetime)) ?? argument.lifetime })
    : argument.kind !== "type" ? argument : Object.freeze({ kind: "type" as const, type: substitute(argument.type) });
  const payload = (selected: RustStructuralMethodPayload) => Object.freeze({
    captures: Object.freeze(selected.captures.map(capture => Object.freeze({ ...capture, storageCarrier: substitute(capture.storageCarrier) }))),
    receiverFields: Object.freeze(selected.receiverFields.map(capture => Object.freeze({ ...capture, storageCarrier: substitute(capture.storageCarrier) }))),
    receivers: Object.freeze(selected.receivers.map(capture => Object.freeze({ ...capture, storageCarrier: substitute(capture.storageCarrier) }))),
  });
  if (bindings === undefined || bindings.types.size !== parameters.size || bindings.lifetimes.size !== lifetimes.size ||
    !rustTargetTypeRefEquals(substitute(template), aligned)) {
    return undefined;
  }
  const dispatchLifetime = definition.dispatchLifetime?.kind === "parameter"
    ? bindings.lifetimes.get(rustLifetimeKey(definition.dispatchLifetime)) : definition.dispatchLifetime;
  if (definition.dispatchLifetime !== undefined && dispatchLifetime === undefined) return undefined;
  return Object.freeze({
    ...definition,
    carrier,
    dispatchLifetime,
    genericArguments: Object.freeze(definition.genericArguments.map(argument)),
    stateGenericArguments: Object.freeze(definition.stateGenericArguments.map(argument)),
    contextMarker: definition.contextMarker === undefined ? undefined : Object.freeze({ ...definition.contextMarker,
      arguments: Object.freeze(definition.contextMarker.arguments.map(argument)) }),
    fields: Object.freeze(definition.fields.map(field => Object.freeze({
      ...field,
      carrier: substitute(field.carrier),
      ...(field.boundStorage === undefined ? {} : { boundStorage: Object.freeze({ ...field.boundStorage, carrier: substitute(field.boundStorage.carrier) }) }),
      ...(field.methodPlan === undefined ? {} : { methodPlan: Object.freeze({ ...field.methodPlan,
        carrier: substitute(field.methodPlan.carrier),
        ...(field.methodPlan.kind !== "fixed" || field.methodPlan.payload === undefined ? {} : { payload: payload(field.methodPlan.payload) }),
        ...(field.methodPlan.kind !== "fixed" || field.methodPlan.context === undefined ? {} : { context: substitute(field.methodPlan.context) }),
        constructions: Object.freeze(field.methodPlan.constructions.map(construction => Object.freeze({ ...construction,
          physicalCarrier: substitute(construction.physicalCarrier),
          destinationCarrier: substitute(construction.destinationCarrier),
          payload: payload(construction.payload),
        }))),
      }) }),
    }))),
    ...(definition.construction === undefined ? {} : { construction: Object.freeze({
      ...definition.construction, carrier: substitute(definition.construction.carrier),
    }) }),
  });
}

export function bindRustStructuralImplementationContract(
  implementation: TargetTypeRef,
  contract: TargetTypeRef,
): TargetTypeRef | undefined {
  const source = rustStructuralObjectCarrierValue(implementation);
  const target = rustStructuralObjectCarrierValue(rustCallableTargetForSourceLifetime(implementation, contract));
  if (source === undefined || target === undefined) return undefined;
  const fields = target.fields.map(field => {
    const selected = source.fields.find(candidate => candidate.sourceName === field.sourceName);
    return selected === undefined || selected.method !== field.method ||
      !closedMetadataEquals(selected.accessor, field.accessor) ? undefined : Object.freeze({ ...field, type: selected.type });
  });
  if (fields.some(field => field === undefined)) return undefined;
  const projection = rustStructuralObjectTargetType(target.ownerFileName, fields as typeof target.fields,
    target.representation, target.construction, target.bases);
  const aligned = rustStructuralObjectTargetType(target.ownerFileName, target.fields,
    target.representation, target.construction, target.bases);
  const references = rustTargetGenericReferences(projection);
  const bindings = inferRustTargetGenericBindings(projection, aligned, {
    typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
    constIdentities: new Set(references.constIdentities),
  });
  if (bindings === undefined || !rustTargetTypeRefEquals(substituteRustTargetGenerics(projection,
    bindings.types, bindings.lifetimes, bindings.consts), aligned)) return undefined;
  return substituteRustTargetGenerics(implementation, bindings.types, bindings.lifetimes, bindings.consts);
}
