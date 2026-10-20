import type { Symbol } from "@tsonic/tsts";

import type { RustSourceProfileRegistry } from "../types/model/source-profile.js";

import type { RustSourcePolicyContext } from "../model/context.js";

import type { SourceFileSemantics } from "@tsonic/target-api/source";
export function resolveOwnedSourceProfileTypeName(
  symbol: Symbol | undefined,
  context: Pick<RustSourcePolicyContext, "ast"> & { readonly currentSemantics: SourceFileSemantics },
  sourceProfiles: RustSourceProfileRegistry,
): string | undefined {
  if (symbol === undefined) {
    return undefined;
  }
  const rawDeclarations = context.currentSemantics.declarations.symbolDeclarations(symbol);
  if (!isDenseDataArray(rawDeclarations) || rawDeclarations.some(declaration => declaration === undefined)) {
    return undefined;
  }
  for (const declaration of rawDeclarations) {
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
  context: Pick<RustSourcePolicyContext, "ast"> & { readonly currentSemantics: SourceFileSemantics },
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
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
