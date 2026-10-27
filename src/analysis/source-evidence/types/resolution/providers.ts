import { denseDefined } from "./project.js";

import { resolveRustTargetType } from "./target.js";

import type { Node, Type } from "@tsonic/tsts";
import type { RustProviderTypeRow } from "../../../../target-model/identities/provider-relations.js";

import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";

import { rustSourceStorageComponentContext } from "./source-storage-projection.js";
import { sourceArrayElementType } from "@tsonic/target-api/source";

import type { RustProviderObjectLiteralConstructionSelection } from "../../../../target-model/records/native/provider-construction.js";
import { resolveProviderTypeIdentity } from "../../../../policy/identities/provider-types.js";
import { providerCarrierFromRelations, instantiateProviderTargetType } from "../../../../policy/types/project/provider-instantiation.js";
import { resolveSourceProfileCarrierFromArguments, selectRustFixedSourceProfileCarrier, rustSourceProfileErrorCarrierNeeded, rustSourceProfileUsesArrayStorage } from "../../../../policy/operations/source-profiles/type-carriers.js";
export function selectRustProviderObjectLiteralConstruction(
  expression: Node,
  expected: TargetTypeRef | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): RustProviderObjectLiteralConstructionSelection {
  if (!context.ast.is.IsObjectLiteralExpression(expression)) {
    return { kind: "not-applicable" };
  }
  const contextual = context.currentSemantics.types.contextualValueSelection(expression);
  if (contextual.kind !== "selected") {
    return { kind: "not-applicable" };
  }
  const identity = resolveProviderTypeIdentity(
    context.currentSemantics.facts.typeSubjects(contextual.component.selectedType),
    context,
  );
  if (identity === undefined) {
    return { kind: "not-applicable" };
  }
  const typeRow = providerCarrierFromRelations(identity, options);
  if (typeRow?.objectLiteralConstruction === undefined) {
    return { kind: "not-applicable" };
  }
  const carrier = instantiateTargetType(
    typeRow,
    contextual.component.selectedType,
    context,
    options,
    new Set(),
  );
  if (carrier === undefined ||
    (expected !== undefined && !rustTargetTypeRefEquals(carrier, expected))) {
    return { kind: "conflict" };
  }
  return { kind: "selected", carrier, typeRow };
}

export function instantiateTargetType(
  base: RustProviderTypeRow,
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const rawArguments = context.currentSemantics.types.isTypeReference(type)
    ? context.currentSemantics.types.typeArguments(type)
    : [];
  const arguments_ = denseDefined(rawArguments);
  if (arguments_ === undefined) {
    return undefined;
  }
  const targetArguments = arguments_
    .map((argument) => resolveRustTargetType(argument, context, options, resolving));
  if (targetArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  if ((base.genericParameters ?? []).some((parameter) => parameter.kind !== "type")) {
    return undefined;
  }
  return instantiateProviderTargetType(
    base,
    (targetArguments as TargetTypeRef[]).map((argument) => ({
      kind: "type" as const,
      type: argument,
    })),
    context.typeDefinitions,
  );
}

export function resolveSourceProfileCarrier(
  name: string,
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const fixed = selectRustFixedSourceProfileCarrier(name, options.jsEnabled);
  if (fixed !== undefined) return fixed;
  if (rustSourceProfileUsesArrayStorage(name)) return resolveRustSourceArrayCarrier(type, context, options, resolving);
  const arguments_ = context.currentSemantics.types.effectiveTypeArguments(type);
  if (arguments_ === undefined) return undefined;
  const carriers = arguments_.map(argument => resolveRustTargetType(argument, context, options, resolving));
  if (carriers.some(carrier => carrier === undefined)) return undefined;
  return resolveSourceProfileCarrierFromArguments(name, carriers as readonly TargetTypeRef[], {
    jsEnabled: options.jsEnabled,
    sourceErrorCarrier: rustSourceProfileErrorCarrierNeeded(name, options.jsEnabled)
      ? options.sourceErrorCarrier(context.sourceStorageResolution?.kind === "resolved"
        ? context.sourceStorageResolution.subject : undefined) : undefined,
  });
}

export function resolveRustSourceArrayCarrier(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const elementType = sourceArrayElementType(type, context.currentSemantics);
  if (elementType === undefined) return undefined;
  const element = resolveRustTargetType(elementType,
    rustSourceStorageComponentContext(context, { kind: "array-element" }), options, resolving);
  return element === undefined ? undefined
    : resolveSourceProfileCarrierFromArguments("Array", [element], { jsEnabled: options.jsEnabled, sourceErrorCarrier: undefined });
}
