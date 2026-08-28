import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  rustSourceTypeExportIds,
  rustSourceProviderVersion,
  rustSourceVirtualModulesProviderId,
  rustTypesModule,
} from "../../../source/semantics/identity.js";
import type {
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type { RustSourcePolicyContext } from "../../model/context.js";
import { resolveProviderTypeIdentity } from "./providers.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./model.js";

export type RustSourceLifetimeTypeContract =
  | { readonly kind: "lifetime-kind" }
  | { readonly kind: "static-lifetime" }
  | { readonly kind: "placeholder-lifetime" }
  | {
      readonly kind: "shared-reference" | "mutable-reference";
      readonly targetTypeNode: Node;
      readonly lifetimeTypeNode?: Node;
    }
  | { readonly kind: "outlives" | "valid-for"; readonly lifetimeTypeNode: Node }
  | {
      readonly kind: "trait-object";
      readonly traitTypeNode: Node;
      readonly lifetimeTypeNode?: Node;
    }
  | { readonly kind: "capture-set"; readonly tupleTypeNode: Node }
  | {
      readonly kind: "opaque-type";
      readonly boundTypeNode: Node;
      readonly captureTypeNode?: Node;
    }
  | { readonly kind: "maybe-sized" };

export function rustSourceLifetimeTypeContract(
  node: Node,
  context: Pick<RustSourcePolicyContext, "source" | "ast" | "facts" | "semanticsFor">,
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

function rustLifetimeTypeContractFor(
  exportId: string,
  args: readonly Node[],
): RustSourceLifetimeTypeContract | undefined {
  switch (exportId) {
    case rustSourceTypeExportIds.life:
      return args.length === 0 ? { kind: "lifetime-kind" } : undefined;
    case rustSourceTypeExportIds.staticLifetime:
      return args.length === 0 ? { kind: "static-lifetime" } : undefined;
    case rustSourceTypeExportIds.placeholderLifetime:
      return args.length === 0 ? { kind: "placeholder-lifetime" } : undefined;
    case rustSourceTypeExportIds.sharedReference:
    case rustSourceTypeExportIds.mutableReference:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: exportId === rustSourceTypeExportIds.sharedReference
              ? "shared-reference"
              : "mutable-reference",
            targetTypeNode: args[0],
            ...(args[1] === undefined ? {} : { lifetimeTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.outlives:
    case rustSourceTypeExportIds.validFor:
      return args.length === 1 && args[0] !== undefined
        ? {
            kind: exportId === rustSourceTypeExportIds.outlives
              ? "outlives"
              : "valid-for",
            lifetimeTypeNode: args[0],
          }
        : undefined;
    case rustSourceTypeExportIds.dynamicTrait:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: "trait-object",
            traitTypeNode: args[0],
            ...(args[1] === undefined ? {} : { lifetimeTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.captureSet:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "capture-set", tupleTypeNode: args[0] }
        : undefined;
    case rustSourceTypeExportIds.opaqueType:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: "opaque-type",
            boundTypeNode: args[0],
            ...(args[1] === undefined ? {} : { captureTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.maybeSized:
      return args.length === 0 ? { kind: "maybe-sized" } : undefined;
    default:
      return undefined;
  }
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
