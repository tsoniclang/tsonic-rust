import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustSourceProviderVersion, rustSourceVirtualModulesProviderId, rustTypesModule } from "../../../../target-model/identities/source.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustSourcePolicyContext } from "../../../../policy/model/context.js";
import { resolveProviderTypeIdentity } from "../../../../policy/identities/provider-types.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";

import { rustLifetimeTypeContractFor } from "../../../../policy/ownership/lifetime-source-contracts.js";
import type { RustSourceLifetimeTypeContract } from "../../../../target-model/records/storage/source-lifetime-types.js";
export function rustSourceLifetimeTypeContract(
  node: Node,
  context: Pick<RustSourcePolicyContext, "source" | "ast" | "records" | "semanticsFor">,
): RustSourceLifetimeTypeContract | undefined {
  if (context.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = context.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined ? undefined : rustSourceLifetimeTypeContract(inner, context);
  }
  if (!context.ast.is.IsTypeReferenceNode(node)) return undefined;
  const semantics = context.semanticsFor(node);
  const typeName = context.ast.as.AsTypeReferenceNode(node)?.TypeName;
  const selected = context.source.navigation.sourceReferenceFor(typeName);
  const identity = selected === undefined
    ? resolveProviderTypeIdentity(semantics.facts.authoredTypeSubjects(node), context)
    : resolveProviderTypeIdentity(
        semantics.facts.selectedSubjects(
          selected.symbol,
          selected.declaration,
        ),
        context,
      );
  if (identity?.providerId !== rustSourceVirtualModulesProviderId ||
    identity.providerVersion !== rustSourceProviderVersion ||
    identity.providerModuleId !== rustTypesModule ||
    identity.moduleSpecifier !== rustTypesModule ||
    identity.exportId === undefined) {
    return undefined;
  }
  const rawArguments = context.ast.typeArguments(node);
  if (rawArguments.some((argument) => argument === undefined)) return undefined;
  return rustLifetimeTypeContractFor(
    identity.exportId,
    rawArguments as readonly Node[],
  );
}

export function resolveRustLifetimeSourceType(
  node: Node,
  contract: RustSourceLifetimeTypeContract,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  resolveAuthored: (
    node: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
    resolving: Set<object>,
  ) => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  switch (contract.kind) {
    case "shared-reference":
    case "mutable-reference": {
      const referent = resolveAuthored(
        contract.targetTypeNode,
        context,
        options,
        resolving,
      );
      const lifetime = contract.lifetimeTypeNode === undefined
        ? undefined
        : context.sourceLifetimes.resolve(contract.lifetimeTypeNode);
      if (referent === undefined ||
        (contract.lifetimeTypeNode !== undefined && lifetime === undefined)) {
        return undefined;
      }
      return Object.freeze({
        kind: "reference" as const,
        referent,
        mutable: contract.kind === "mutable-reference",
        ...(lifetime === undefined ? {} : { lifetime }),
      });
    }
    case "trait-object": {
      const principal = resolveAuthored(
        contract.traitTypeNode,
        context,
        options,
        resolving,
      );
      const lifetime = contract.lifetimeTypeNode === undefined
        ? undefined
        : context.sourceLifetimes.resolve(contract.lifetimeTypeNode);
      return principal?.kind !== "trait-ref" ||
          (contract.lifetimeTypeNode !== undefined && lifetime === undefined)
        ? undefined
        : Object.freeze({
            kind: "trait-object" as const,
            principal,
            autoTraits: Object.freeze([]),
            ...(lifetime === undefined ? {} : { lifetime }),
          });
    }
    case "opaque-type": {
      const bound = resolveAuthored(
        contract.boundTypeNode,
        context,
        options,
        resolving,
      );
      const captures = contract.captureTypeNode === undefined
        ? Object.freeze([])
        : resolveLifetimeCaptures(contract.captureTypeNode, context);
      const identity = sourceNodeIdentity(context.ast, node);
      return bound?.kind !== "trait-ref" || captures === undefined || identity === undefined
        ? undefined
        : Object.freeze({
            kind: "impl-trait" as const,
            id: `source-opaque\0${identity}`,
            bounds: Object.freeze([bound]),
            outlives: Object.freeze([]),
            captures,
          });
    }
    case "lifetime-kind":
    case "static-lifetime":
    case "placeholder-lifetime":
    case "outlives":
    case "valid-for":
    case "capture-set":
    case "maybe-sized":
      return undefined;
  }
}

function resolveLifetimeCaptures(
  tupleNode: Node,
  context: RustTargetTypeResolutionContext,
): readonly RustTargetGenericArgument[] | undefined {
  const contract = rustSourceLifetimeTypeContract(tupleNode, context);
  const selectedTuple = contract?.kind === "capture-set"
    ? contract.tupleTypeNode
    : tupleNode;
  if (context.ast.kindName(selectedTuple) !== "KindTupleType") return undefined;
  const elements = context.ast.elements(selectedTuple);
  if (elements.some((element) => element === undefined)) return undefined;
  const lifetimes = elements.map((element) => context.sourceLifetimes.resolve(element));
  return lifetimes.some((lifetime) => lifetime === undefined)
    ? undefined
    : Object.freeze(lifetimes.map((lifetime) => Object.freeze({
        kind: "lifetime" as const,
        lifetime: lifetime!,
      })));
}
