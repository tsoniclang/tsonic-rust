import type { SourceStorageEffects } from "@tsonic/target-api/analysis";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { jsSourceCallStorageEffect } from "@tsonic/js-source-profile";
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
  return Object.freeze({
    call(node, call) {
      if (call.sourceSelectedSignatureKind !== "resolved") return undefined;
      const semantics = source.semantics.forNode(node);
      const declaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
      const identity = resolveSelectedSourceProfileMember(context, declaration, sourceProfiles);
      if (identity === undefined) return undefined;
      const effect = jsSourceCallStorageEffect(identity, call);
      return identity.profile === "js" || effect?.resultAllocation !== undefined ? effect : undefined;
    },
  } satisfies SourceStorageEffects);
}
