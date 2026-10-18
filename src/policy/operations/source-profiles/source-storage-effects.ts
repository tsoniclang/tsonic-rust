import type { SourceStorageEffects } from "@tsonic/target-api/analysis";
import { createSourceGlobalCallStorageEffects } from "@tsonic/target-api/analysis";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { selectJsSourceCallStorageEffect, jsSourceCallableParameterEffects, jsSourceNativeConstructorStorage } from "@tsonic/js-source-profile";
import { resolveSelectedSourceProfileMember } from "../../identities/selected-source.js";
import type { RustSourceProfileRegistry } from "../../types/model/source-profile.js";

export function createRustSourceProfileStorageEffects(
  source: TargetSourceProgram,
  sourceProfiles: RustSourceProfileRegistry,
): SourceStorageEffects {
  const context: Parameters<typeof resolveSelectedSourceProfileMember>[0] = {
    ast: source.ast,
    source,
    semanticsFor: source.semantics.forNode,
  };
  const global = createSourceGlobalCallStorageEffects(source, (node, call) => {
    const semantics = source.semantics.forNode(node);
    const declaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
    const identity = resolveSelectedSourceProfileMember(context, declaration, sourceProfiles);
    if (identity === undefined) return undefined;
    return identity.profile === "js" || identity.memberName === "constructor" || identity.memberName === "call"
      ? selectJsSourceCallStorageEffect(identity, call) : undefined;
  }, declaration => {
    const identity = resolveSelectedSourceProfileMember(context, declaration, sourceProfiles);
    return jsSourceNativeConstructorStorage(identity);
  });
  return Object.freeze({ ...global,
    callbackEntries(node, call) {
      const semantics = source.semantics.forNode(node);
      const declaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
      const identity = resolveSelectedSourceProfileMember(context, declaration, sourceProfiles);
      const nativeConstructor = identity?.profile === "native" && identity.ownerName === "PromiseConstructor" &&
        identity.memberName === "constructor" && declaration !== undefined && identity.declaration === declaration &&
        source.ast.is.IsNewExpression(node) && source.ast.is.IsConstructSignatureDeclaration(declaration) &&
        call.sourceSelectedSignatureKind === "resolved";
      return identity?.profile === "js" || nativeConstructor ? jsSourceCallableParameterEffects(identity) : undefined;
    },
  } satisfies SourceStorageEffects);
}
