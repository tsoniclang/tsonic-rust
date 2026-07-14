import {
  providerVirtualDeclarationFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  ExtensionObservationContext,
  Node,
  ProviderDeclarationIdentity,
  TargetTypeRef,
} from "@tsonic/tsts";
import { asSourceNode } from "../../common/source-ast.js";
import { rustTargetTypeRefEquals } from "../rust-target-types.js";
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
  context: ExtensionObservationContext,
  selectedSubject: ExtensionFactSubject | undefined,
  corroboratingSubjects: readonly (ExtensionFactSubject | undefined)[] = [],
): RustSelectedProviderDeclarationResolution {
  if (selectedSubject === undefined) {
    return { kind: "missing" };
  }
  const selectedFact = context.factResolver.resolve(selectedSubject, providerVirtualDeclarationFactKey);
  if (selectedFact === undefined) {
    return { kind: "missing" };
  }
  if (!providerDeclarationIdentityIsClosed(selectedFact)) {
    return { kind: "conflict", identities: [selectedFact] };
  }
  const identities: ProviderDeclarationIdentity[] = [];
  let selected: ProviderDeclarationIdentity = selectedFact;
  identities.push(selectedFact);
  for (const subject of corroboratingSubjects) {
    if (subject === undefined) {
      continue;
    }
    const fact = context.factResolver.resolve(subject, providerVirtualDeclarationFactKey);
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
  const exportName = mergeOptionalIdentityValue(left.exportName, right.exportName);
  const exportId = mergeOptionalIdentityValue(left.exportId, right.exportId);
  const memberName = mergeOptionalIdentityValue(left.memberName, right.memberName);
  const memberId = mergeOptionalIdentityValue(left.memberId, right.memberId);
  const memberStatic = mergeOptionalIdentityValue(left.memberStatic, right.memberStatic);
  const signatureId = mergeOptionalIdentityValue(left.signatureId, right.signatureId);
  if ([providerVersion, exportName, exportId, memberName, memberId, memberStatic, signatureId]
    .some((value) => value === identityConflict)) {
    return undefined;
  }
  const targetIdentity = mergeTargetIdentity(left.targetIdentity, right.targetIdentity);
  if (targetIdentity === identityConflict) {
    return undefined;
  }
  return {
    providerId: left.providerId,
    providerModuleId: left.providerModuleId,
    moduleSpecifier: left.moduleSpecifier,
    ...(providerVersion === undefined ? {} : { providerVersion }),
    ...(left.virtualFileName === undefined && right.virtualFileName === undefined
      ? {}
      : { virtualFileName: left.virtualFileName ?? right.virtualFileName }),
    ...(exportName === undefined ? {} : { exportName }),
    ...(exportId === undefined ? {} : { exportId }),
    ...(memberName === undefined ? {} : { memberName }),
    ...(memberId === undefined ? {} : { memberId }),
    ...(memberStatic === undefined ? {} : { memberStatic }),
    ...(signatureId === undefined ? {} : { signatureId }),
    ...(targetIdentity === undefined ? {} : { targetIdentity }),
  } as ProviderDeclarationIdentity;
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
    : ["memberId", "memberName"] as const;
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

function mergeTargetIdentity(
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
): TargetTypeRef | undefined | typeof identityConflict {
  return left !== undefined && right !== undefined && !rustTargetTypeRefEquals(left, right)
    ? identityConflict
    : left ?? right;
}

export function resolveSelectedJsSourceMember(
  context: ExtensionObservationContext,
  declarationSubject: ExtensionFactSubject | undefined,
  sourceProfiles: RustSourceProfileRegistry,
): RustSelectedSourceMemberIdentity | undefined {
  const selected = resolveSelectedSourceProfileMember(context, declarationSubject, sourceProfiles);
  return selected?.profile === "js" ? selected : undefined;
}

export function resolveSelectedSourceProfileMember(
  context: ExtensionObservationContext,
  declarationSubject: ExtensionFactSubject | undefined,
  sourceProfiles: RustSourceProfileRegistry,
): RustSelectedSourceMemberIdentity | undefined {
  const declaration = asNode(declarationSubject, context);
  const profile = declaration === undefined
    ? undefined
    : sourceProfiles.profileForNode(declaration, context.compiler.ast);
  if (declaration === undefined || profile === undefined) {
    return undefined;
  }
  const { ast } = context.compiler;
  let owner = ast.parent(declaration);
  while (owner !== undefined && !ast.is.IsInterfaceDeclaration(owner)) {
    owner = ast.parent(owner);
  }
  if (owner === undefined) {
    return undefined;
  }
  const ownerName = ast.text(ast.name(owner));
  const memberName = ast.is.IsIndexSignatureDeclaration(declaration)
    ? "index"
    : ast.is.IsConstructSignatureDeclaration(declaration)
      ? "constructor"
      : ast.text(ast.name(declaration));
  return ownerName.length > 0 && memberName.length > 0
    ? { profile, ownerName, memberName, declaration }
    : undefined;
}

export function resolveSelectedJsSourceExportName(
  context: ExtensionObservationContext,
  declarationSubject: ExtensionFactSubject | undefined,
  sourceProfiles: RustSourceProfileRegistry,
): string | undefined {
  const declaration = asNode(declarationSubject, context);
  if (declaration === undefined || sourceProfiles.profileForNode(declaration, context.compiler.ast) !== "js") {
    return undefined;
  }
  const name = context.compiler.ast.text(context.compiler.ast.name(declaration));
  return name.length === 0 ? undefined : name;
}

export function isProjectSourceDeclaration(
  context: ExtensionObservationContext,
  declarationSubject: ExtensionFactSubject | undefined,
): declarationSubject is Node {
  const declaration = asNode(declarationSubject, context);
  if (declaration === undefined) {
    return false;
  }
  const fileName = context.compiler.ast.getFileName(context.compiler.ast.getSourceFile(declaration));
  return fileName.length > 0 && !fileName.endsWith(".d.ts");
}

export function asNode(
  subject: ExtensionFactSubject | undefined,
  context: Pick<ExtensionObservationContext, "compiler">,
): Node | undefined {
  return asSourceNode(subject, context.compiler.ast);
}
