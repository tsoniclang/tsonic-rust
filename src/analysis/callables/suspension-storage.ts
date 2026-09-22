import type { Node } from "@tsonic/tsts";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";
import type { RustSuspendedCallableStorage } from "../facts/keys.js";
import { selectRustSuspendedStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSuspendedOwnedReceiver } from "../facts/callables-and-resources.js";

export type RustSuspendedCallableStorageResolution =
  | {
      readonly kind: "resolved";
      readonly capturedParameters: readonly Node[];
      readonly storage: RustSuspendedCallableStorage;
      readonly ownedReceiver?: RustSuspendedOwnedReceiver;
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
  const receiverOccurrences: Node[] = [];
  const visit = (node: Node): void => {
    if (ast.is.IsFunctionExpression(node) || ast.is.IsFunctionDeclaration(node) ||
      ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node)) return;
    if (ast.kindName(node) === "KindThisKeyword" || ast.kindName(node) === "KindThisExpression") {
      receiverOccurrences.push(node);
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

  const owner = walk.context.projectTypes.definitionContainingDeclaration(declaration);
  const representation = walk.context.objectRepresentations.representationFor(owner);
  const ownsReceiver = receiverOccurrences.length > 0 && !ast.hasModifierKind(declaration, "static") &&
    owner !== undefined && representation !== undefined && representation.kind !== "value";
  const ownedReceiver: RustSuspendedOwnedReceiver | undefined = ownsReceiver
    ? Object.freeze({ carrier: walk.context.projectTypes.openCarrier(owner), occurrences: Object.freeze(receiverOccurrences) })
    : undefined;
  if (receiverOccurrences.length > 0 && !ast.hasModifierKind(declaration, "static") && ownedReceiver === undefined) {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      storage: Object.freeze({ kind: "receiver" }),
    };
  }

  const carriers: TargetTypeRef[] = [...storedCarriers, ...(ownedReceiver === undefined ? [] : [ownedReceiver.carrier])];
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
      ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
    };
  }
  return {
    kind: "resolved",
    capturedParameters: Object.freeze(capturedParameters),
    storage: Object.freeze({ kind: "lifetime", lifetime }),
    ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
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
