import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustSourceTypeContractFactKey } from "../../../source/semantics/facts.js";
import type { RustSourceTypeContractFact } from "../../../source/semantics/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./model.js";

export function rustSourceLifetimeTypeContract(
  node: Node,
  context: RustTargetTypeResolutionContext,
): RustSourceTypeContractFact | undefined {
  return context.facts.resolve(node, rustSourceTypeContractFactKey) ??
    context.facts.get(node, rustSourceTypeContractFactKey);
}

export function resolveRustLifetimeSourceType(
  node: Node,
  contract: RustSourceTypeContractFact,
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
      return principal === undefined ||
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
      return bound === undefined || captures === undefined || identity === undefined
        ? undefined
        : Object.freeze({
            kind: "impl-trait" as const,
            id: `source-opaque\0${identity}`,
            bounds: Object.freeze([bound]),
            captures,
          });
    }
    case "lifetime-kind":
    case "static-lifetime":
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
): readonly import("../../../target-model/lifetimes/index.js").RustLifetimeRef[] | undefined {
  const contract = rustSourceLifetimeTypeContract(tupleNode, context);
  const selectedTuple = contract?.kind === "capture-set"
    ? contract.tupleTypeNode
    : tupleNode;
  if (context.ast.kindName(selectedTuple) !== "KindTupleType") return undefined;
  const elements = context.ast.elements(selectedTuple);
  if (elements.some((element) => element === undefined)) return undefined;
  const captures = elements.map((element) => context.sourceLifetimes.resolve(element));
  return captures.some((capture) => capture === undefined)
    ? undefined
    : Object.freeze(captures as readonly import("../../../target-model/lifetimes/index.js").RustLifetimeRef[]);
}
