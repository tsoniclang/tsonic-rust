import { createSourceCallOnlyAliasQuery } from "@tsonic/target-api/source";
import type { SourceCallOnlyAlias } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { RustSourceProfileRegistry } from "../../types/source-profile.js";
import { resolveSelectedSourceProfileMember } from "../../evidence/selected-source.js";

export function createRustSourceProfileCallableAliasQuery(
  context: RustSourcePolicyContext,
  profiles: RustSourceProfileRegistry,
): (declaration: import("@tsonic/tsts").Node) => SourceCallOnlyAlias | undefined {
  const select = createSourceCallOnlyAliasQuery(context.source);
  return declaration => {
    const alias = select(declaration);
    return acceptsSourceProfileAlias(alias, context, profiles) ? alias : undefined;
  };
}

function acceptsSourceProfileAlias(
  alias: SourceCallOnlyAlias | undefined,
  context: RustSourcePolicyContext,
  profiles: RustSourceProfileRegistry,
): boolean {
  if (alias === undefined || resolveSelectedSourceProfileMember(
    context, alias.selectedDeclaration, profiles,
  ) === undefined) return false;
  if (alias.property === undefined) return context.ast.is.IsFunctionDeclaration(alias.selectedDeclaration);
  const receiver = alias.receiverDeclaration;
  const profile = profiles.profileForNode(alias.selectedDeclaration, context.ast);
  return receiver !== undefined && context.ast.is.IsVariableDeclaration(receiver) &&
    context.ast.as.AsVariableDeclaration(receiver)?.Initializer === undefined &&
    profile !== undefined && profiles.profileForNode(receiver, context.ast) === profile;
}
