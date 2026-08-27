import type { Node } from "@tsonic/tsts";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";
import {
  rustLifetimeKey,
  rustLifetimeOutlives,
} from "../../target-model/lifetimes/index.js";
import type {
  RustLifetimeRef,
  RustSourceGenericContract,
} from "../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";

export type RustGeneratorStorageResolution =
  | {
      readonly kind: "resolved";
      readonly capturedParameters: readonly Node[];
      readonly storage:
        | { readonly kind: "static" }
        | { readonly kind: "receiver" }
        | { readonly kind: "lifetime"; readonly lifetime: RustLifetimeRef };
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function resolveRustGeneratorStorage(
  walk: RustFactWalk,
  declaration: Node,
  protocolCarriers: readonly TargetTypeRef[],
): RustGeneratorStorageResolution {
  const { ast } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) {
    return { kind: "rejected", reason: "A generator has no concrete source body." };
  }
  const parameters = ast.parameters(declaration);
  if (parameters.some((parameter) => parameter === undefined)) {
    return { kind: "rejected", reason: "A generator contains an undefined parameter slot." };
  }
  const exactParameters = parameters as readonly Node[];
  const parameterSet = new Set(exactParameters);
  const capturedParameterSet = new Set<Node>();
  let capturesReceiver = false;
  const visit = (node: Node): void => {
    if (ast.kindName(node) === "KindThisKeyword") {
      capturesReceiver = true;
    } else if (ast.kindName(node) === "KindIdentifier") {
      const selectedDeclaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
      const ownerParameter = selectedDeclaration === undefined
        ? undefined
        : containingParameter(selectedDeclaration, parameterSet, ast);
      if (ownerParameter !== undefined) {
        capturedParameterSet.add(ownerParameter);
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  visit(body);
  const capturedParameters = exactParameters.filter((parameter) =>
    capturedParameterSet.has(parameter));

  if (capturesReceiver && !ast.hasModifierKind(declaration, "static")) {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      storage: Object.freeze({ kind: "receiver" }),
    };
  }

  const carriers: TargetTypeRef[] = [...protocolCarriers];
  for (const parameter of capturedParameters) {
    const carrier = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey)
      ?.parameterCarrier;
    if (carrier === undefined) {
      return {
        kind: "rejected",
        reason: "A captured generator parameter has no exact finalized Rust ABI carrier.",
      };
    }
    carriers.push(carrier);
  }
  const contract = walk.context.sourceLifetimes.contractFor(declaration);
  const candidates = new Map<string, RustLifetimeRef>();
  for (const carrier of carriers) {
    const references = rustTargetGenericReferences(carrier);
    if (references.hasUnnameableLifetime) {
      return {
        kind: "rejected",
        reason: "A generator storage lifetime cannot be named from an elided, placeholder, or call-scoped captured lifetime.",
      };
    }
    for (const lifetime of references.lifetimes) {
      candidates.set(rustLifetimeKey(lifetime), lifetime);
    }
    for (const name of references.typeNames) {
      const parameter = contract?.parameters.find((candidate) =>
        candidate.kind === "type" && candidate.targetName === name);
      for (const lifetime of parameter?.kind === "type" ? parameter.outlives : []) {
        if (lifetime.kind !== "static") {
          candidates.set(rustLifetimeKey(lifetime), lifetime);
        }
      }
    }
  }
  if (candidates.size === 0) {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      storage: Object.freeze({ kind: "static" }),
    };
  }
  if (contract === undefined) {
    return {
      kind: "rejected",
      reason: "A borrowed generator has no exact source generic lifetime contract.",
    };
  }
  const lifetime = selectShortestAuthoredLifetime([...candidates.values()], contract);
  if (lifetime === undefined) {
    return {
      kind: "rejected",
      reason: "A generator's captured lifetimes have no single exact authored storage lifetime.",
    };
  }
  if (lifetime.kind === "static") {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      storage: Object.freeze({ kind: "static" }),
    };
  }
  return {
    kind: "resolved",
    capturedParameters: Object.freeze(capturedParameters),
    storage: Object.freeze({ kind: "lifetime", lifetime }),
  };
}

function containingParameter(
  selectedDeclaration: Node,
  parameters: ReadonlySet<Node>,
  ast: RustFactWalk["context"]["ast"],
): Node | undefined {
  let current: Node | undefined = selectedDeclaration;
  while (current !== undefined) {
    if (parameters.has(current)) return current;
    current = ast.parent(current);
  }
  return undefined;
}

function selectShortestAuthoredLifetime(
  candidates: readonly RustLifetimeRef[],
  contract: RustSourceGenericContract,
): RustLifetimeRef | undefined {
  const eligible = candidates.filter((candidate) =>
    candidates.every((source) => rustLifetimeOutlives(source, candidate, contract)));
  return eligible.length === 1 ? eligible[0] : undefined;
}
