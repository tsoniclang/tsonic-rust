import type { Node } from "@tsonic/tsts";
import type { SourceTypeDescriptor, TargetSourceProgram } from "@tsonic/target-api/source";
import { sourceDeclarationOwnershipUnresolved, type SourceDeclarationOwnershipBudget,
  type SourceDeclarationOwnershipUnresolved } from "@tsonic/target-api/analysis";
import type { RustProviderSemantics } from "../../../target-model/metadata/provider-metadata.js";
import type { RustSourceProfileRegistry } from "../../../policy/types/model/source-profile.js";
import { resolveOwnedSourceProfileTypeNameForDeclaration } from "../../../policy/identities/source-types.js";
import { selectRustSourceProfileCompletionKind } from "../../../policy/operations/source-profiles/type-carriers.js";
import { resolveProviderTypeIdentity } from "../../../policy/identities/provider-types.js";
import { providerCarrierFromRelations } from "../../../policy/types/project/provider-instantiation.js";
import { isRustNativeFutureCarrier } from "../../../target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../target-model/types/carriers/promises.js";

export function selectRustPublishedCompletion(node: Node, context: {
  readonly source: TargetSourceProgram;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly providerSemantics: Pick<RustProviderSemantics, "types">;
  readonly jsEnabled: boolean;
}, budget: SourceDeclarationOwnershipBudget): {
  readonly kind: "resolved"; readonly nativeFuture: boolean; readonly jsPromise: boolean;
} | SourceDeclarationOwnershipUnresolved {
  const { source } = context;
  const outcome = source.effectiveTypes.get(node);
  if (outcome === undefined || outcome.kind === "refused") return sourceDeclarationOwnershipUnresolved(node,
    "Native completion requires this occurrence's finalized Source type descriptor.");
  type Completion = { readonly kind: "resolved"; readonly nativeFuture: boolean; readonly jsPromise: boolean };
  const none: Completion = Object.freeze({ kind: "resolved", nativeFuture: false, jsPromise: false });
  const active = new Set<SourceTypeDescriptor>();
  const select = (descriptor: SourceTypeDescriptor): Completion | SourceDeclarationOwnershipUnresolved => {
    if (!budget.step(node)) return budget.failure()!;
    if (active.has(descriptor)) return sourceDeclarationOwnershipUnresolved(node,
      "Native completion requires a finite outer completion family, not a recursive alias assumption.");
    active.add(descriptor);
    try {
      if (descriptor.kind === "optional") return select(descriptor.value);
      if (descriptor.kind === "union") {
        let nativeFuture = false;
        let jsPromise = false;
        for (const member of descriptor.types) {
          const completion = select(member);
          if (completion.kind === "unresolved") return completion;
          nativeFuture ||= completion.nativeFuture;
          jsPromise ||= completion.jsPromise;
        }
        return Object.freeze({ kind: "resolved", nativeFuture, jsPromise });
      }
      if (descriptor.kind !== "declared") return none;
      const declaration = descriptor.declaration;
      const name = resolveOwnedSourceProfileTypeNameForDeclaration(declaration,
        { ast: source.ast, currentSemantics: source.semantics.forNode(declaration) }, context.sourceProfiles);
      const profile = name === undefined ? undefined : selectRustSourceProfileCompletionKind(name, context.jsEnabled);
      if (profile !== undefined) return Object.freeze({ kind: "resolved",
        nativeFuture: profile === "native-future", jsPromise: profile === "js-promise" });
      const identity = resolveProviderTypeIdentity([declaration], { source });
      if (identity !== undefined) {
        const row = providerCarrierFromRelations(identity, { providerTypes: context.providerSemantics.types });
        if (row === undefined) return sourceDeclarationOwnershipUnresolved(node,
          "A provider completion requires its exact published declaration's native carrier relation.");
        return Object.freeze({ kind: "resolved", nativeFuture: isRustNativeFutureCarrier(row.targetCarrier),
          jsPromise: rustJsPromiseOutputTargetType(row.targetCarrier) !== undefined });
      }
      if (!source.ast.is.IsTypeAliasDeclaration(declaration)) return none;
      if (descriptor.definition === undefined) return sourceDeclarationOwnershipUnresolved(node,
        "An aliased native completion requires its published instantiated definition, never its raw formal body.");
      return select(descriptor.definition);
    } finally { active.delete(descriptor); }
  };
  return select(outcome.type);
}
