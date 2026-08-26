import {
  rustFutureTargetType,
  rustGeneratorTargetType,
  rustAsyncGeneratorTargetType,
  rustIteratorResultTargetType,
  rustJsArrayTargetType,
  rustJsDateTargetType,
  rustJsMapTargetType,
  rustJsRegExpExecArrayTargetType,
  rustJsRegExpIndicesTargetType,
  rustJsRegExpMatchArrayTargetType,
  rustJsRegExpNamedGroupsTargetType,
  rustJsRegExpNamedIndicesTargetType,
  rustJsRegExpStringIteratorTargetType,
  rustJsRegExpTargetType,
  rustJsSetTargetType,
  rustJsErrorTargetType,
  rustRegExpExecArrayTargetType,
  rustRegExpIndicesTargetType,
  rustRegExpMatchArrayTargetType,
  rustRegExpNamedGroupsTargetType,
  rustRegExpNamedIndicesTargetType,
  rustRegExpStringIteratorTargetType,
  rustStringTargetType,
  rustTupleElementCarriers,
  rustVecTargetType,
  rustGenericParameterIdentity,
  rustClosureTargetType,
  substituteRustTargetGenerics,
  type RustTraitSupportQueries,
} from "../../../target-model/types/index.js";
import { rustTypeSemanticKey } from "../../../target-model/semantics/index.js";
import { denseDefined } from "./project.js";
import { mergeProviderDeclarationIdentities } from "../../evidence/selected-source.js";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { resolveRustTargetType } from "./target.js";
import {
  resolveRustProviderGenericRequirements,
  rustResolvedProviderTypeRequirementsAreSatisfied,
} from "../provider-generic-requirements.js";
import { rustProviderOperationOwnerMatches } from "../../operations/provider-selection.js";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { RustProviderTypeRow } from "../../../providers/packages/model.js";
import type { RustSourceProfileRegistry } from "../source-profile.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustGenericArgument } from "../../../target-model/semantics/index.js";
import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

const regExpIdentity = jsRegExpSourceProfileIdentity;
const regExpResultCarrierByOwner = new Map<string, () => TargetTypeRef>([
  [regExpIdentity.owners.regExpExecArray, rustRegExpExecArrayTargetType],
  [regExpIdentity.owners.regExpMatchArray, rustRegExpMatchArrayTargetType],
  [regExpIdentity.owners.regExpIndicesArray, rustRegExpIndicesTargetType],
  [regExpIdentity.owners.regExpNamedGroups, rustRegExpNamedGroupsTargetType],
  [regExpIdentity.owners.regExpNamedIndices, rustRegExpNamedIndicesTargetType],
  [regExpIdentity.owners.jsRegExpExecArray, rustJsRegExpExecArrayTargetType],
  [regExpIdentity.owners.jsRegExpMatchArray, rustJsRegExpMatchArrayTargetType],
  [regExpIdentity.owners.jsRegExpIndicesArray, rustJsRegExpIndicesTargetType],
  [regExpIdentity.owners.jsRegExpNamedGroups, rustJsRegExpNamedGroupsTargetType],
  [regExpIdentity.owners.jsRegExpNamedIndices, rustJsRegExpNamedIndicesTargetType],
]);

export type RustProviderObjectLiteralConstructionSelection =
  | { readonly kind: "not-applicable" }
  | {
    readonly kind: "selected";
    readonly carrier: TargetTypeRef;
    readonly typeRow: RustProviderTypeRow;
  }
  | { readonly kind: "conflict" };

export function resolveProviderTypeIdentity(
  subjects: readonly ExtensionFactSubject[],
  context: RustTargetTypeResolutionContext,
): ProviderDeclarationIdentity | undefined {
  let selected: ProviderDeclarationIdentity | undefined;
  for (const subject of subjects) {
    const fact = context.facts.get(subject, providerVirtualDeclarationFactKey);
    if (fact === undefined) {
      continue;
    }
    if (selected === undefined) {
      selected = fact;
      continue;
    }
    const merged = mergeProviderDeclarationIdentities(selected, fact);
    if (merged === undefined) {
      return undefined;
    }
    selected = merged;
  }
  return selected;
}

export function providerCarrierFromRelations(
  identity: ProviderDeclarationIdentity,
  options: RustTargetTypeResolutionOptions,
): RustProviderTypeRow | undefined {
  if (identity.exportId === undefined) {
    return undefined;
  }
  const relations = options.providerTypes.filter((row) =>
    rustProviderOperationOwnerMatches(row, identity) &&
    row.exportId === identity.exportId);
  if (relations.length !== 1) {
    return undefined;
  }
  return relations[0];
}

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
    context.currentSemantics.facts.typeSubjects(contextual.type),
    context,
  );
  if (identity === undefined) {
    return { kind: "not-applicable" };
  }
  const typeRow = providerCarrierFromRelations(identity, options);
  if (typeRow?.objectLiteralConstruction?.kind !== "struct-default") {
    return { kind: "not-applicable" };
  }
  const carrier = instantiateTargetType(
    typeRow,
    contextual.type,
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
  if (base.sourceGenericBindings.some((binding) =>
    binding.target.kind === "generic-parameter" &&
    binding.target.parameter.kind !== "type")) {
    return undefined;
  }
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
  return instantiateProviderTargetType(
    base,
    (targetArguments as TargetTypeRef[]).map((value) => Object.freeze({
      kind: "type" as const,
      value,
    })),
    context.sourceGenerics,
    context.traits,
  );
}

export function instantiateProviderTargetType(
  relation: RustProviderTypeRow,
  arguments_: readonly RustGenericArgument[],
  sourceGenerics: import("../source-generics.js").RustSourceGenericIndex,
  traits: RustTraitSupportQueries,
): TargetTypeRef | undefined {
  if (relation.sourceGenericBindings.length !== arguments_.length) {
    return undefined;
  }
  const lifetimeSubstitutions = new Map<string, import("../../../target-model/semantics/index.js").RustLifetimeRef>();
  const typeSubstitutions = new Map<string, TargetTypeRef>();
  const constSubstitutions = new Map<string, import("../../../target-model/semantics/index.js").RustConstExpr>();
  const associatedTypeSubstitutions = new Map<string, TargetTypeRef>();
  const requirementsByName = new Map<string, TargetTypeRef>();
  for (const [index, binding] of relation.sourceGenericBindings.entries()) {
    const argument = arguments_[index];
    if (argument === undefined) {
      return undefined;
    }
    if (binding.target.kind === "associated-type") {
      if (argument.kind !== "type") return undefined;
      const projection = substituteRustTargetGenerics(binding.target.projection, {
        lifetimes: lifetimeSubstitutions,
        types: typeSubstitutions,
        consts: constSubstitutions,
        associatedTypes: associatedTypeSubstitutions,
      });
      if (projection.kind !== "associated-type") return undefined;
      const projectionKey = rustTypeSemanticKey(projection);
      const existing = associatedTypeSubstitutions.get(projectionKey);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, argument.value)) {
        return undefined;
      }
      associatedTypeSubstitutions.set(projectionKey, argument.value);
      requirementsByName.set(binding.sourceName, argument.value);
      continue;
    }
    if (binding.target.kind === "semantic-parameter") {
      if (argument.kind !== "type") return undefined;
      requirementsByName.set(binding.sourceName, argument.value);
      continue;
    }
    const identity = rustGenericParameterIdentity(binding.target.parameter);
    if (identity === undefined || argument.kind !== identity.kind) return undefined;
    switch (argument.kind) {
      case "lifetime":
        lifetimeSubstitutions.set(identity.identityKey, argument.value);
        break;
      case "type":
        typeSubstitutions.set(identity.identityKey, argument.value);
        requirementsByName.set(binding.sourceName, argument.value);
        break;
      case "const":
        constSubstitutions.set(identity.identityKey, argument.value);
        break;
    }
  }
  const substitutions = {
    lifetimes: lifetimeSubstitutions,
    types: typeSubstitutions,
    consts: constSubstitutions,
    associatedTypes: associatedTypeSubstitutions,
  };
  const requirements = resolveRustProviderGenericRequirements(
    relation.typeRequirements,
    requirementsByName,
    substitutions,
  );
  if (requirements === undefined ||
    !rustResolvedProviderTypeRequirementsAreSatisfied(
      requirements,
      sourceGenerics,
      traits,
    )) {
    return undefined;
  }
  const targetCarrier = substituteRustTargetGenerics(relation.targetCarrier, substitutions);
  const callableRole = relation.semanticRoles?.find((role) => role.kind === "callable-trait");
  if (callableRole === undefined) return targetCarrier;
  const argumentBySourceName = new Map(relation.sourceGenericBindings.map((binding, index) =>
    [binding.sourceName, arguments_[index]] as const));
  const parameterTuple = argumentBySourceName.get(callableRole.parameterTupleSourceName);
  const result = argumentBySourceName.get(callableRole.resultSourceName);
  const parameters = parameterTuple?.kind === "type"
    ? rustTupleElementCarriers(parameterTuple.value)
    : undefined;
  return parameters !== undefined && result?.kind === "type"
    ? rustClosureTargetType({
        callTrait: callableRole.callTrait,
        parameters,
        result: result.value,
      })
    : undefined;
}

export function resolveOwnedSourceProfileTypeName(
  symbol: Symbol | undefined,
  context: RustTargetTypeResolutionContext,
  sourceProfiles: RustSourceProfileRegistry,
): string | undefined {
  if (symbol === undefined) {
    return undefined;
  }
  const declarations = denseDefined(
    context.currentSemantics.declarations.symbolDeclarations(symbol),
  );
  if (declarations === undefined) {
    return undefined;
  }
  for (const declaration of declarations) {
    const name = resolveOwnedSourceProfileTypeNameForDeclaration(
      declaration,
      context,
      sourceProfiles,
    );
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}

export function resolveOwnedSourceProfileTypeNameForDeclaration(
  declaration: import("@tsonic/tsts").Node | undefined,
  context: RustTargetTypeResolutionContext,
  sourceProfiles: RustSourceProfileRegistry,
): string | undefined {
  if (
    declaration === undefined ||
    sourceProfiles.profileForNode(declaration, context.ast) === undefined ||
    (!context.ast.is.IsClassDeclaration(declaration) &&
      !context.ast.is.IsInterfaceDeclaration(declaration) &&
      !context.ast.is.IsTypeAliasDeclaration(declaration) &&
      !context.ast.is.IsEnumDeclaration(declaration))
  ) {
    return undefined;
  }
  const nameNode = context.ast.name(declaration);
  if (!context.ast.is.IsIdentifier(nameNode)) {
    return undefined;
  }
  const name = context.ast.text(nameNode);
  return name.length === 0 ? undefined : name;
}

export function resolveSourceProfileCarrier(
  name: string,
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (name === "String") {
    return rustStringTargetType();
  }
  if (options.jsEnabled && name === "Date") {
    return rustJsDateTargetType();
  }
  if (options.jsEnabled && name === regExpIdentity.owners.regExp) {
    return rustJsRegExpTargetType();
  }
  const regExpResultCarrier = options.jsEnabled
    ? regExpResultCarrierByOwner.get(name)
    : undefined;
  if (regExpResultCarrier !== undefined) {
    return regExpResultCarrier();
  }
  if (!context.currentSemantics.types.isTypeReference(type)) {
    return undefined;
  }
  const arguments_ = context.currentSemantics.types.typeArguments(type);
  const targetArguments = arguments_.map((argument) => resolveRustTargetType(argument, context, options, resolving));
  if (options.jsEnabled && name === regExpIdentity.owners.regExpStringIterator) {
    const [element] = targetArguments;
    return targetArguments.length === 1 && element !== undefined &&
        rustTargetTypeRefEquals(element, rustRegExpExecArrayTargetType())
      ? rustRegExpStringIteratorTargetType()
      : undefined;
  }
  if (options.jsEnabled && name === regExpIdentity.owners.jsRegExpStringIterator) {
    const [element] = targetArguments;
    return targetArguments.length === 1 && element !== undefined &&
        rustTargetTypeRefEquals(element, rustJsRegExpExecArrayTargetType())
      ? rustJsRegExpStringIteratorTargetType()
      : undefined;
  }
  const direct = targetArguments.every((argument) => argument !== undefined)
    ? resolveSourceProfileCarrierFromArguments(name, targetArguments as TargetTypeRef[], options)
    : undefined;
  if (direct !== undefined && name !== "Array" && name !== "ReadonlyArray") {
    return direct;
  }
  if (name === "Promise" || name === "PromiseLike") {
    const output = resolveRustTargetType(arguments_[0], context, options, resolving);
    return output === undefined ? undefined : rustFutureTargetType(output);
  }
  if (name === "Generator" || name === "AsyncGenerator") {
    const [yieldType, returnType, nextType] = targetArguments;
    if (yieldType === undefined || returnType === undefined || nextType === undefined) {
      return undefined;
    }
    const protocol = { yieldType, returnType, nextType };
    return name === "Generator"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  if (name === "IteratorResult" || name === "IteratorYieldResult" || name === "IteratorReturnResult") {
    const yieldType = targetArguments[0];
    const returnType = name === "IteratorYieldResult" ? yieldType : targetArguments[1] ?? yieldType;
    return yieldType === undefined || returnType === undefined
      ? undefined
      : rustIteratorResultTargetType({ yieldType, returnType });
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const elementType = arguments_[0];
    const element = resolveRustTargetType(elementType, context, options, resolving);
    return element === undefined
      ? undefined
      : options.jsEnabled
        ? rustJsArrayTargetType(element)
        : rustVecTargetType(element);
  }
  if (options.jsEnabled && (name === "Map" || name === "ReadonlyMap")) {
    const key = resolveRustTargetType(arguments_[0], context, options, resolving);
    const value = resolveRustTargetType(arguments_[1], context, options, resolving);
    return key === undefined || value === undefined ? undefined : rustJsMapTargetType(key, value);
  }
  if (options.jsEnabled && (name === "Set" || name === "ReadonlySet")) {
    const value = resolveRustTargetType(arguments_[0], context, options, resolving);
    return value === undefined ? undefined : rustJsSetTargetType(value);
  }
  return undefined;
}

export function resolveSourceProfileCarrierFromArguments(
  name: string,
  arguments_: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (name === "String") {
    return rustStringTargetType();
  }
  if (name === "Error" && arguments_.length === 0) {
    return rustJsErrorTargetType();
  }
  if (name === "Promise" || name === "PromiseLike") {
    const [output] = arguments_;
    return output === undefined ? undefined : rustFutureTargetType(output);
  }
  if (name === "Generator" || name === "AsyncGenerator") {
    const [yieldType, returnType, nextType] = arguments_;
    if (yieldType === undefined || returnType === undefined || nextType === undefined) {
      return undefined;
    }
    const protocol = { yieldType, returnType, nextType };
    return name === "Generator"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  if (name === "IteratorResult" || name === "IteratorYieldResult" || name === "IteratorReturnResult") {
    const yieldType = arguments_[0];
    const returnType = name === "IteratorYieldResult" ? yieldType : arguments_[1] ?? yieldType;
    return yieldType === undefined || returnType === undefined
      ? undefined
      : rustIteratorResultTargetType({ yieldType, returnType });
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const [element] = arguments_;
    if (element === undefined) {
      return undefined;
    }
    return options.jsEnabled ? rustJsArrayTargetType(element) : rustVecTargetType(element);
  }
  if (options.jsEnabled && (name === "Map" || name === "ReadonlyMap")) {
    const [key, value] = arguments_;
    return key === undefined || value === undefined ? undefined : rustJsMapTargetType(key, value);
  }
  if (options.jsEnabled && (name === "Set" || name === "ReadonlySet")) {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsSetTargetType(value);
  }
  if (options.jsEnabled && name === "Date") {
    return rustJsDateTargetType();
  }
  if (options.jsEnabled && name === regExpIdentity.owners.regExp) {
    return rustJsRegExpTargetType();
  }
  const regExpResultCarrier = options.jsEnabled
    ? regExpResultCarrierByOwner.get(name)
    : undefined;
  if (regExpResultCarrier !== undefined) {
    return regExpResultCarrier();
  }
  if (options.jsEnabled && name === regExpIdentity.owners.regExpStringIterator) {
    const [element] = arguments_;
    return arguments_.length === 1 && element !== undefined &&
        rustTargetTypeRefEquals(element, rustRegExpExecArrayTargetType())
      ? rustRegExpStringIteratorTargetType()
      : undefined;
  }
  if (options.jsEnabled && name === regExpIdentity.owners.jsRegExpStringIterator) {
    const [element] = arguments_;
    return arguments_.length === 1 && element !== undefined &&
        rustTargetTypeRefEquals(element, rustJsRegExpExecArrayTargetType())
      ? rustJsRegExpStringIteratorTargetType()
      : undefined;
  }
  return undefined;
}
