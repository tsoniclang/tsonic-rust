import type { Node } from "@tsonic/tsts";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";
import type { RustSuspendedCallableStorage } from "../facts/keys.js";
import { selectRustSuspendedStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";

export type RustSuspendedCallableStorageResolution =
  | {
      readonly kind: "resolved";
      readonly capturedParameters: readonly Node[];
      readonly storage: RustSuspendedCallableStorage;
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function resolveRustSuspendedCallableStorage(
  walk: RustFactWalk,
  declaration: Node,
  storedCarriers: readonly TargetTypeRef[],
): RustSuspendedCallableStorageResolution {
  const { ast } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) {
    return { kind: "rejected", reason: "A suspended callable has no concrete source body." };
  }
  const parameters = ast.parameters(declaration);
  if (parameters.some((parameter) => parameter === undefined)) {
    return { kind: "rejected", reason: "A suspended callable contains an undefined parameter slot." };
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

  const carriers: TargetTypeRef[] = [...storedCarriers];
  for (const parameter of capturedParameters) {
    const carrier = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey)
      ?.parameterCarrier;
    if (carrier === undefined) {
      return {
        kind: "rejected",
        reason: "A captured suspended-callable parameter has no exact finalized Rust ABI carrier.",
      };
    }
    carriers.push(carrier);
  }
  const contract = walk.context.sourceLifetimes.contractFor(declaration);
  const lifetime = selectRustSuspendedStorageLifetime(carriers, contract);
  if (lifetime === undefined) {
    return {
      kind: "rejected",
        reason: "A suspended callable's captured lifetimes have no single exact authored storage lifetime; elided, placeholder, or call-scoped captures cannot define escaping storage.",
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
