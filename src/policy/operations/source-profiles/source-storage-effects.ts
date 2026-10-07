import type { SourceStorageEffects } from "@tsonic/target-api/analysis";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { createJsSourceCallStorageEffects } from "@tsonic/js-source-profile";
import { resolveSelectedSourceProfileMember } from "../../evidence/selected-source.js";
import type { RustSourceProfileRegistry } from "../../types/source-profile.js";

export function createRustSourceProfileStorageEffects(
  source: TargetSourceProgram,
  sourceProfiles: RustSourceProfileRegistry,
): SourceStorageEffects {
  const context: Parameters<typeof resolveSelectedSourceProfileMember>[0] = {
    ast: source.ast,
    facts: { get: (subject, key) => source.sourceFacts.getFact(subject, key) },
    semanticsFor: source.semantics.forNode,
  };
  return createJsSourceCallStorageEffects(source, (node, call) => {
    const semantics = source.semantics.forNode(node);
    const declaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
    const identity = resolveSelectedSourceProfileMember(context, declaration, sourceProfiles);
    if (identity === undefined) return undefined;
    return identity.profile === "js" || identity.memberName === "constructor" || identity.memberName === "call"
      ? identity : undefined;
  });
}
