import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { RustSourceProfileRegistry } from "../types/model/source-profile.js";
import { resolveSelectedJsSourceMember, resolveSelectedProviderDeclaration } from "./selected-source.js";

export function rustSourceUnionMemberDeclarationIsOwned(
  declaration: Node,
  context: RustSourcePolicyContext,
  options: { readonly jsEnabled: boolean; readonly sourceProfiles: RustSourceProfileRegistry },
): boolean {
  return context.source.navigation.isProjectDeclaration(declaration) ||
    resolveSelectedProviderDeclaration(context, declaration).kind === "selected" ||
    options.jsEnabled && resolveSelectedJsSourceMember(context, declaration, options.sourceProfiles) !== undefined;
}
