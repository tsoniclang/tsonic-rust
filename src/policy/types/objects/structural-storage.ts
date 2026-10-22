import type { RustStructuralShapeDefinition } from "../../../target-model/records/structural-shapes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../target-model/types/index.js";

import { visitRustTargetTypeParameters } from "../../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters, substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustCarrierWithTargetPlaceholderLifetimes } from "../../../target-model/types/placeholder-lifetimes.js";

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
    rustStructuralObjectTargetType(componentForFile(shape.ownerFileName), shape.fields, shape.representation, shape.construction, shape.bases));
}

export function instantiateStructuralDefinition(
  definition: RustStructuralShapeDefinition,
  carrier: TargetTypeRef,
): RustStructuralShapeDefinition | undefined {
  if (rustTargetTypeRefEquals(definition.carrier, carrier)) {
    return definition;
  }
  const parameters = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "type" ? [parameter.identity] : []));
  const lifetimes = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
  const shape = rustStructuralObjectCarrierValue(carrier);
  const aligned = shape === undefined ? carrier : rustStructuralObjectTargetType(definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases);
  // A placeholder lifetime in a definition has no lifetime parameter of its own, so the struct stores it as 'static and
  // a 'static instance lifetime instantiates it.
  const template = rustCarrierWithTargetPlaceholderLifetimes(definition.carrier, aligned, lifetime => lifetime.kind === "static");
  const bindings = inferRustTargetGenericBindings(template, aligned, {
    typeIdentities: parameters, lifetimeIdentities: lifetimes, constIdentities: new Set(),
  });
  const substitute = (type: TargetTypeRef) => bindings === undefined ? type :
    substituteRustTargetGenerics(type, bindings.types, bindings.lifetimes, bindings.consts);
  if (bindings === undefined || bindings.types.size !== parameters.size || bindings.lifetimes.size !== lifetimes.size ||
    !rustTargetTypeRefEquals(substitute(template), aligned)) {
    return undefined;
  }
  return Object.freeze({
    ...definition,
    carrier,
    genericArguments: Object.freeze(definition.genericArguments.map(argument => {
      if (argument.kind === "lifetime") return Object.freeze({ kind: "lifetime" as const,
        lifetime: bindings.lifetimes.get(rustLifetimeKey(argument.lifetime)) ?? argument.lifetime });
      if (argument.kind !== "type") return argument;
      return Object.freeze({ kind: "type" as const, type: substitute(argument.type) });
    })),
    fields: Object.freeze(definition.fields.map(field => Object.freeze({
      ...field,
      carrier: substitute(field.carrier),
      ...(field.boundStorage === undefined ? {} : { boundStorage: Object.freeze({ ...field.boundStorage, carrier: substitute(field.boundStorage.carrier) }) }),
      ...(field.methodStorageCarrier === undefined ? {} : {
        methodStorageCarrier: substitute(field.methodStorageCarrier),
      }),
      ...(field.methodConstructions === undefined ? {} : {
        methodConstructions: Object.freeze(field.methodConstructions.map(construction => Object.freeze({ ...construction,
          physicalCarrier: substitute(construction.physicalCarrier),
          destinationCarrier: substitute(construction.destinationCarrier),
        }))),
      }),
    }))),
    ...(definition.construction === undefined ? {} : { construction: Object.freeze({
      ...definition.construction, carrier: substitute(definition.construction.carrier),
    }) }),
  });
}
