import type { RustNamedTypeTraitContract } from "../../../target-model/types/model.js";

import type { RustProviderTypeDefinition } from "../../../target-model/identities/provider-relations.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { mapRustProgramErrorRoute } from "../../../target-model/conversions/program-error.js";

import { materializeProviderCarrier } from "./carriers.js";
export function materializeProviderValueConversion(
  conversion: RustValueConversion,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustValueConversion {
  switch (conversion.kind) {
    case "program-error": {
      const materialize = (carrier: TargetTypeRef): TargetTypeRef =>
        materializeProviderCarrier(carrier, carrierPaths, carrierTraits, typeDeclarations);
      return { ...conversion, source: materialize(conversion.source), target: materialize(conversion.target),
        route: mapRustProgramErrorRoute(conversion.route, materialize) };
    }
    case "union-map":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
        arms: conversion.arms.map(arm => ({ ...arm,
          carrier: materializeProviderCarrier(arm.carrier, carrierPaths, carrierTraits, typeDeclarations),
          source: arm.source.map(step => ({ ...step, union: materializeProviderCarrier(step.union, carrierPaths, carrierTraits, typeDeclarations) })),
          target: arm.target.map(step => ({ ...step, union: materializeProviderCarrier(step.union, carrierPaths, carrierTraits, typeDeclarations) })),
        })),
      };
    case "rest-sequence":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        elementTarget: materializeProviderCarrier(conversion.elementTarget, carrierPaths, carrierTraits, typeDeclarations),
        elementConversions: conversion.elementConversions.map(element => element === null ? null :
          materializeProviderValueConversion(element, carrierPaths, carrierTraits, typeDeclarations)) as typeof conversion.elementConversions,
      };
    case "copy-from-reference":
      return {
        ...conversion,
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "raw-pointer-mut-to-const":
      return {
        ...conversion,
        pointee: materializeProviderCarrier(conversion.pointee, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "source-union-variant":
      return { ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
        payloadCarrier: materializeProviderCarrier(conversion.payloadCarrier, carrierPaths, carrierTraits, typeDeclarations),
        payloadConversion: conversion.payloadConversion === null ? null :
          materializeProviderValueConversion(conversion.payloadConversion, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "union-project":
    case "exact-integer":
    case "native-representation":
    case "callable-input":
    case "native-upcast":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "js-array-backing":
      return { ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "closed-value-from-option":
    case "js-value-from-array":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
        elementConversion: materializeProviderValueConversion(
          conversion.elementConversion,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ) as typeof conversion.elementConversion,
      };
    case "js-value-from-closed-carrier":
    case "ts-value-from-closed-carrier":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "union-fold":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
        arms: conversion.arms.map((arm) => ({
          ...arm,
          carrier: materializeProviderCarrier(
            arm.carrier,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ),
          path: arm.path.map(step => ({ ...step,
            union: materializeProviderCarrier(step.union, carrierPaths, carrierTraits, typeDeclarations),
          })),
          conversion: materializeProviderValueConversion(
            arm.conversion,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ) as typeof arm.conversion,
        })),
      };
    case "js-value-from-structural-to-json":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        resultCarrier: materializeProviderCarrier(
          conversion.resultCarrier,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ),
        resultConversion: materializeProviderValueConversion(
          conversion.resultConversion,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ) as typeof conversion.resultConversion,
      };
    case "js-value-from-properties":
    case "js-value-from-structural-object": {
      const source = materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations);
      const mapField = <Field extends (typeof conversion.fields)[number]>(field: Field) => ({
          ...field,
          sourceCarrier: materializeProviderCarrier(
            field.sourceCarrier,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ),
          conversion: materializeProviderValueConversion(
            field.conversion,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ) as typeof field.conversion,
        });
      return conversion.kind === "js-value-from-properties"
        ? { ...conversion, source, fields: conversion.fields.map(mapField) }
        : { ...conversion, source, fields: conversion.fields.map(mapField) };
    }
    case "option-some":
      return { ...conversion,
        elementConversion: conversion.elementConversion === null ? null : materializeProviderValueConversion(conversion.elementConversion, carrierPaths, carrierTraits, typeDeclarations) as typeof conversion.elementConversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "source-optional":
      return {
        ...conversion,
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "option-map":
      return {
        ...conversion,
        elementConversion: materializeProviderValueConversion(
          conversion.elementConversion,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ) as typeof conversion.elementConversion,
      };
    case "semantic-conversion":
    case "numeric-promotion":
    case "integer-refinement":
      return conversion;
  }
}
