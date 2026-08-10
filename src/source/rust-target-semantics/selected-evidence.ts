import {
  providerVirtualDeclarationFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  ProviderMemberKey,
} from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../../policy/context.js";
import { rustPolicyNode } from "../../policy/context.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";

export interface RustSelectedSourceMemberIdentity {
  readonly profile: "native" | "js";
  readonly ownerName: string;
  readonly memberName: string;
  readonly declaration: Node;
}

export type RustSelectedProviderDeclarationResolution =
  | { readonly kind: "missing" }
  | { readonly kind: "selected"; readonly identity: ProviderDeclarationIdentity }
  | { readonly kind: "conflict"; readonly identities: readonly ProviderDeclarationIdentity[] };

export function resolveSelectedProviderDeclaration(
  context: RustSourcePolicyContext,
  selectedSubject: ExtensionFactSubject | undefined,
  corroboratingSubjects: readonly (ExtensionFactSubject | undefined)[] = [],
): RustSelectedProviderDeclarationResolution {
  if (selectedSubject === undefined) {
    return { kind: "missing" };
  }
  const selectedFact = context.facts.get(selectedSubject, providerVirtualDeclarationFactKey);
  if (selectedFact === undefined) {
    return { kind: "missing" };
  }
  if (!providerDeclarationIdentityIsClosed(selectedFact)) {
    return { kind: "conflict", identities: [selectedFact] };
  }
  const identities: ProviderDeclarationIdentity[] = [selectedFact];
  let selected: ProviderDeclarationIdentity = selectedFact;
  for (const subject of corroboratingSubjects) {
    const fact = context.facts.get(subject, providerVirtualDeclarationFactKey);
    if (fact === undefined) {
      continue;
    }
    identities.push(fact);
    const merged = mergeProviderDeclarationIdentities(selected, fact);
    if (merged === undefined) {
      return { kind: "conflict", identities };
    }
    selected = merged;
  }
  return { kind: "selected", identity: selected };
}

export function mergeProviderDeclarationIdentities(
  left: ProviderDeclarationIdentity,
  right: ProviderDeclarationIdentity,
): ProviderDeclarationIdentity | undefined {
  if (!providerDeclarationIdentityIsClosed(left) ||
    !providerDeclarationIdentityIsClosed(right) ||
    left.providerId !== right.providerId ||
    left.providerModuleId !== right.providerModuleId ||
    left.moduleSpecifier !== right.moduleSpecifier ||
    !identityLevelCoordinatesOverlap(left, right, "export") ||
    !identityLevelCoordinatesOverlap(left, right, "member")) {
    return undefined;
  }
  const providerVersion = mergeOptionalIdentityValue(left.providerVersion, right.providerVersion);
  const artifactFileName = mergeOptionalIdentityValue(left.artifactFileName, right.artifactFileName);
  const exportName = mergeOptionalIdentityValue(left.exportName, right.exportName);
  const exportId = mergeOptionalIdentityValue(left.exportId, right.exportId);
  const memberName = mergeOptionalIdentityValue(left.memberName, right.memberName);
  const memberId = mergeOptionalIdentityValue(left.memberId, right.memberId);
  const memberStatic = mergeOptionalIdentityValue(left.memberStatic, right.memberStatic);
  const signatureId = mergeOptionalIdentityValue(left.signatureId, right.signatureId);
  const memberKey = mergeMemberKey(left.memberKey, right.memberKey);
  if (
    providerVersion === identityConflict ||
    artifactFileName === identityConflict ||
    exportName === identityConflict ||
    exportId === identityConflict ||
    memberName === identityConflict ||
    memberId === identityConflict ||
    memberStatic === identityConflict ||
    signatureId === identityConflict ||
    memberKey === identityConflict
  ) {
    return undefined;
  }
  return {
    providerId: left.providerId,
    providerModuleId: left.providerModuleId,
    moduleSpecifier: left.moduleSpecifier,
    ...(providerVersion === undefined ? {} : { providerVersion }),
    ...(artifactFileName === undefined ? {} : { artifactFileName }),
    ...(exportName === undefined ? {} : { exportName }),
    ...(exportId === undefined ? {} : { exportId }),
    ...(memberName === undefined ? {} : { memberName }),
    ...(memberKey === undefined ? {} : { memberKey }),
    ...(memberId === undefined ? {} : { memberId }),
    ...(memberStatic === undefined ? {} : { memberStatic }),
    ...(signatureId === undefined ? {} : { signatureId }),
  };
}

function providerDeclarationIdentityIsClosed(identity: ProviderDeclarationIdentity): boolean {
  return (identity.exportName === undefined || identity.exportId !== undefined) &&
    (identity.memberName === undefined || identity.memberId !== undefined) &&
    (identity.memberId === undefined || identity.exportId !== undefined);
}

function identityLevelCoordinatesOverlap(
  left: ProviderDeclarationIdentity,
  right: ProviderDeclarationIdentity,
  level: "export" | "member",
): boolean {
  const keys = level === "export"
    ? ["exportId", "exportName"] as const
    : ["memberId", "memberName", "memberKey"] as const;
  const leftHasCoordinate = keys.some((key) => left[key] !== undefined);
  const rightHasCoordinate = keys.some((key) => right[key] !== undefined);
  if (!leftHasCoordinate || !rightHasCoordinate) {
    return true;
  }
  return keys.some((key) => left[key] !== undefined && right[key] !== undefined);
}

const identityConflict = Symbol("provider-identity-conflict");

function mergeOptionalIdentityValue<T extends string | boolean>(
  left: T | undefined,
  right: T | undefined,
): T | undefined | typeof identityConflict {
  return left !== undefined && right !== undefined && left !== right
    ? identityConflict
    : left ?? right;
}

function mergeMemberKey(
  left: ProviderMemberKey | undefined,
  right: ProviderMemberKey | undefined,
): ProviderMemberKey | undefined | typeof identityConflict {
  if (left === undefined || right === undefined) {
    return left ?? right;
  }
  return left.kind === right.kind && left.name === right.name
    ? left
    : identityConflict;
}

export function resolveSelectedJsSourceMember(
  context: RustSourcePolicyContext,
  declarationSubject: ExtensionFactSubject | undefined,
  sourceProfiles: RustSourceProfileRegistry,
): RustSelectedSourceMemberIdentity | undefined {
  const selected = resolveSelectedSourceProfileMember(context, declarationSubject, sourceProfiles);
  return selected?.profile === "js" ? selected : undefined;
}

export function resolveSelectedSourceProfileMember(
  context: RustSourcePolicyContext,
  declarationSubject: ExtensionFactSubject | undefined,
  sourceProfiles: RustSourceProfileRegistry,
): RustSelectedSourceMemberIdentity | undefined {
  const declaration = rustPolicyNode(context, declarationSubject);
  const profile = declaration === undefined
    ? undefined
    : sourceProfiles.profileForNode(declaration, context.ast);
  if (declaration === undefined || profile === undefined) {
    return undefined;
  }
  let owner = context.ast.parent(declaration);
  while (owner !== undefined && !context.ast.is.IsInterfaceDeclaration(owner)) {
    owner = context.ast.parent(owner);
  }
  if (owner === undefined) {
    return undefined;
  }
  const ownerName = context.ast.text(context.ast.name(owner));
  const memberName = context.ast.is.IsIndexSignatureDeclaration(declaration)
    ? "index"
    : context.ast.is.IsConstructSignatureDeclaration(declaration)
      ? "constructor"
      : context.ast.text(context.ast.name(declaration));
  return ownerName.length > 0 && memberName.length > 0
    ? { profile, ownerName, memberName, declaration }
    : undefined;
}

export function resolveSelectedJsSourceExportName(
  context: RustSourcePolicyContext,
  declarationSubject: ExtensionFactSubject | undefined,
  sourceProfiles: RustSourceProfileRegistry,
): string | undefined {
  const declaration = rustPolicyNode(context, declarationSubject);
  if (declaration === undefined || sourceProfiles.profileForNode(declaration, context.ast) !== "js") {
    return undefined;
  }
  const name = context.ast.text(context.ast.name(declaration));
  return name.length === 0 ? undefined : name;
}

export function isProjectSourceDeclaration(
  context: RustSourcePolicyContext,
  declarationSubject: ExtensionFactSubject | undefined,
): declarationSubject is Node {
  const declaration = rustPolicyNode(context, declarationSubject);
  if (declaration === undefined) {
    return false;
  }
  const sourceFile = context.ast.getSourceFile(declaration);
  return context.ast.getFileName(sourceFile).length > 0 && !context.ast.isDeclarationFile(sourceFile);
}

export function asNode(
  subject: ExtensionFactSubject | undefined,
  context: RustSourcePolicyContext,
): Node | undefined {
  return rustPolicyNode(context, subject);
}
