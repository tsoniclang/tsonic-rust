import type { Node } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../types/resolution/model.js";
import { resolveSelectedJsSourceMember } from "./selected-source.js";

export function rustSourceUnionMemberDeclarationIsOwned(
  declaration: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): boolean {
  return context.source.navigation.isProjectDeclaration(declaration) ||
    options.jsEnabled && resolveSelectedJsSourceMember(context, declaration, options.sourceProfiles) !== undefined;
}
