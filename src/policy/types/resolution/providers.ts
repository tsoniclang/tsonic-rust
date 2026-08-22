import {
  rustFutureTargetType,
  rustGeneratorTargetType,
  rustAsyncGeneratorTargetType,
  rustIteratorResultTargetType,
  rustJsArrayTargetType,
  rustJsDateTargetType,
  rustJsMapTargetType,
  rustJsSetTargetType,
  rustJsErrorTargetType,
  rustStringTargetType,
  rustVecTargetType,
  substituteRustTargetTypeParameters,
} from "../../../target-model/types/index.js";
import { denseDefined } from "./project.js";
import { mergeProviderDeclarationIdentities } from "../../evidence/selected-source.js";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { resolveRustTargetType } from "./target.js";
import { rustProviderGenericRequirementsAreSatisfied } from "../provider-generic-requirements.js";
import { rustProviderOperationOwnerMatches } from "../../operations/provider-selection.js";
import type {
  ExtensionFactSubject,
  ProviderDeclarationIdentity,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { RustProviderTypeRow } from "../../../providers/packages/model.js";
import type { RustSourceProfileRegistry } from "../source-profile.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";

const regExpOwner = jsRegExpSourceProfileIdentity.owners.regExp;
const regExpResultOwners = new Set<string>([
  jsRegExpSourceProfileIdentity.owners.regExpExecArray,
  jsRegExpSourceProfileIdentity.owners.regExpMatchArray,
]);

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
  return instantiateProviderTargetType(base, targetArguments as TargetTypeRef[]);
}

export function instantiateProviderTargetType(
  relation: RustProviderTypeRow,
  arguments_: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  if (relation.sourceTypeParameters.length !== arguments_.length) {
    return undefined;
  }
  const substitutions = new Map(
    relation.sourceTypeParameters.map((name, index) => [name, arguments_[index]!] as const),
  );
  if (!rustProviderGenericRequirementsAreSatisfied(relation.typeRequirements, substitutions)) {
    return undefined;
  }
  return substituteRustTargetTypeParameters(relation.targetCarrier, substitutions);
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
  if (options.jsEnabled && name === regExpOwner) {
    return { kind: "target-named", id: "rust.js.JsRegExp" };
  }
  if (options.jsEnabled && regExpResultOwners.has(name)) {
    return { kind: "target-named", id: "rust.js.JsRegExpMatch" };
  }
  if (!context.currentSemantics.types.isTypeReference(type)) {
    return undefined;
  }
  const arguments_ = context.currentSemantics.types.typeArguments(type);
  const targetArguments = arguments_.map((argument) => resolveRustTargetType(argument, context, options, resolving));
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
  if (options.jsEnabled && name === regExpOwner) {
    return { kind: "target-named", id: "rust.js.JsRegExp" };
  }
  if (options.jsEnabled && regExpResultOwners.has(name)) {
    return { kind: "target-named", id: "rust.js.JsRegExpMatch" };
  }
  return undefined;
}
