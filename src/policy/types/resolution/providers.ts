import {
  rustFutureTargetType,
  rustGeneratorTargetType,
  rustAsyncGeneratorTargetType,
  rustIteratorResultTargetType,
  rustJsArrayTargetType,
  rustJsArrayBufferTargetType,
  rustJsDataViewTargetType,
  rustJsDateTargetType,
  rustJsMapTargetType,
  rustJsPromiseTargetType,
  rustJsPromiseFulfilledResultTargetType,
  rustJsPromiseRejectedResultTargetType,
  rustJsPromiseSettledResultTargetType,
  rustJsIntlCollatorTargetType,
  rustJsIntlDateTimeFormatPartTargetType,
  rustJsIntlDateTimeFormatTargetType,
  rustJsIntlNumberFormatPartTargetType,
  rustJsIntlNumberFormatTargetType,
  rustJsIntlResolvedCollatorOptionsTargetType,
  rustJsIntlResolvedDateTimeFormatOptionsTargetType,
  rustJsIntlResolvedNumberFormatOptionsTargetType,
  rustJsRegExpExecArrayTargetType,
  rustJsRegExpIndicesTargetType,
  rustJsRegExpMatchArrayTargetType,
  rustJsRegExpNamedGroupsTargetType,
  rustJsRegExpNamedIndicesTargetType,
  rustJsRegExpStringIteratorTargetType,
  rustJsRegExpTargetType,
  rustJsSetTargetType,
  rustJsTypedArrayTargetType,
  rustJsWeakMapTargetType,
  rustJsWeakSetTargetType,
  rustJsErrorTargetType,
  rustRegExpExecArrayTargetType,
  rustRegExpIndicesTargetType,
  rustRegExpMatchArrayTargetType,
  rustRegExpNamedGroupsTargetType,
  rustRegExpNamedIndicesTargetType,
  rustRegExpStringIteratorTargetType,
  rustStringTargetType,
  rustVecTargetType,
  substituteRustTargetGenerics,
} from "../../../target-model/types/index.js";
import { denseDefined } from "./project.js";
import { mergeProviderDeclarationIdentities } from "../../evidence/selected-source.js";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { resolveRustTargetType } from "./target.js";
import { rustProviderGenericRequirementsAreSatisfied } from "../provider-generic-requirements.js";
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
import type {
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import type { RustSourcePolicyContext } from "../../model/context.js";

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
  context: Pick<RustSourcePolicyContext, "facts">,
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
  );
}

export function instantiateProviderTargetType(
  relation: RustProviderTypeRow,
  arguments_: readonly RustTargetGenericArgument[],
): TargetTypeRef | undefined {
  const parameters = relation.genericParameters ?? [];
  if (arguments_.length > parameters.length) {
    return undefined;
  }
  const typeSubstitutions = new Map<string, TargetTypeRef>();
  const lifetimeSubstitutions = new Map<string, import("../../../target-model/lifetimes/index.js").RustLifetimeRef>();
  const constSubstitutions = new Map<string, import("../../../target-model/types/model.js").RustTargetConstArgument>();
  for (const [index, parameter] of parameters.entries()) {
    const authored = arguments_[index];
    const selected = authored ?? (parameter.kind === "lifetime"
      ? undefined
      : parameter.defaultArgument === undefined
        ? undefined
        : substituteGenericArgument(
            parameter.defaultArgument,
            typeSubstitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ));
    if (selected === undefined || selected.kind !== parameter.kind) {
      return undefined;
    }
    if (parameter.kind === "type" && selected.kind === "type") {
      typeSubstitutions.set(parameter.sourceName, selected.type);
    } else if (parameter.kind === "lifetime" && selected.kind === "lifetime") {
      lifetimeSubstitutions.set(parameter.targetIdentity, selected.lifetime);
    } else if (parameter.kind === "const" && selected.kind === "const") {
      constSubstitutions.set(parameter.targetIdentity, selected.value);
    }
  }
  if (!rustProviderGenericRequirementsAreSatisfied(
    relation.typeRequirements,
    typeSubstitutions,
  )) {
    return undefined;
  }
  return substituteRustTargetGenerics(
    relation.targetCarrier,
    typeSubstitutions,
    lifetimeSubstitutions,
    constSubstitutions,
  );
}

function substituteGenericArgument(
  argument: RustTargetGenericArgument,
  types: ReadonlyMap<string, TargetTypeRef>,
  lifetimes: ReadonlyMap<string, import("../../../target-model/lifetimes/index.js").RustLifetimeRef>,
  consts: ReadonlyMap<string, import("../../../target-model/types/model.js").RustTargetConstArgument>,
): RustTargetGenericArgument {
  if (argument.kind === "type") {
    return {
      kind: "type",
      type: substituteRustTargetGenerics(argument.type, types, lifetimes, consts),
    };
  }
  if (argument.kind === "lifetime") {
    return {
      kind: "lifetime",
      lifetime: lifetimes.get(rustLifetimeKey(argument.lifetime)) ??
        argument.lifetime,
    };
  }
  return argument.value.kind === "parameter"
    ? {
        kind: "const",
        value: consts.get(argument.value.identity) ?? argument.value,
      }
    : argument;
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
  const directJsCarrier = options.jsEnabled ? rustDirectJsSourceProfileCarrier(name) : undefined;
  if (directJsCarrier !== undefined) {
    return directJsCarrier;
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
    return output === undefined
      ? undefined
      : options.jsEnabled
        ? rustJsPromiseTargetType(output)
        : rustFutureTargetType(output);
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
  if (options.jsEnabled && name === "WeakMap") {
    const [key, value] = targetArguments;
    return key === undefined || value === undefined ? undefined : rustJsWeakMapTargetType(key, value);
  }
  if (options.jsEnabled && name === "WeakSet") {
    const [value] = targetArguments;
    return value === undefined ? undefined : rustJsWeakSetTargetType(value);
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
    return output === undefined
      ? undefined
      : options.jsEnabled
        ? rustJsPromiseTargetType(output)
        : rustFutureTargetType(output);
  }
  if (options.jsEnabled && name === "PromiseFulfilledResult") {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsPromiseFulfilledResultTargetType(value);
  }
  if (options.jsEnabled && name === "PromiseRejectedResult" && arguments_.length === 0) {
    return rustJsPromiseRejectedResultTargetType();
  }
  if (options.jsEnabled && name === "PromiseSettledResult") {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsPromiseSettledResultTargetType(value);
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
  if (options.jsEnabled && name === "WeakMap") {
    const [key, value] = arguments_;
    return key === undefined || value === undefined ? undefined : rustJsWeakMapTargetType(key, value);
  }
  if (options.jsEnabled && name === "WeakSet") {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsWeakSetTargetType(value);
  }
  if (options.jsEnabled && name === "Date") {
    return rustJsDateTargetType();
  }
  const directJsCarrier = options.jsEnabled ? rustDirectJsSourceProfileCarrier(name) : undefined;
  if (directJsCarrier !== undefined) {
    return directJsCarrier;
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

function rustDirectJsSourceProfileCarrier(name: string): TargetTypeRef | undefined {
  switch (name) {
    case "ArrayBuffer": return rustJsArrayBufferTargetType();
    case "DataView": return rustJsDataViewTargetType();
    case "Int8Array": return rustJsTypedArrayTargetType("Int8Array");
    case "Uint8Array": return rustJsTypedArrayTargetType("Uint8Array");
    case "Uint8ClampedArray": return rustJsTypedArrayTargetType("Uint8ClampedArray");
    case "Int16Array": return rustJsTypedArrayTargetType("Int16Array");
    case "Uint16Array": return rustJsTypedArrayTargetType("Uint16Array");
    case "Int32Array": return rustJsTypedArrayTargetType("Int32Array");
    case "Uint32Array": return rustJsTypedArrayTargetType("Uint32Array");
    case "Float32Array": return rustJsTypedArrayTargetType("Float32Array");
    case "Float64Array": return rustJsTypedArrayTargetType("Float64Array");
    case "IntlDateTimeFormat": return rustJsIntlDateTimeFormatTargetType();
    case "IntlNumberFormat": return rustJsIntlNumberFormatTargetType();
    case "IntlCollator": return rustJsIntlCollatorTargetType();
    case "IntlDateTimeFormatPart": return rustJsIntlDateTimeFormatPartTargetType();
    case "IntlNumberFormatPart": return rustJsIntlNumberFormatPartTargetType();
    case "IntlResolvedDateTimeFormatOptions": return rustJsIntlResolvedDateTimeFormatOptionsTargetType();
    case "IntlResolvedNumberFormatOptions": return rustJsIntlResolvedNumberFormatOptionsTargetType();
    case "IntlResolvedCollatorOptions": return rustJsIntlResolvedCollatorOptionsTargetType();
    default: return undefined;
  }
}
