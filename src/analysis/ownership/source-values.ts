import type { Node } from "@tsonic/tsts";
import { Node_Type } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import { rustSourceTypeContractFactKey } from "../../source/semantics/facts.js";
import type { RustSourceValueContract } from "../../target-model/semantics/index.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";

export interface RustSourceValueInventory {
  readonly contracts: WeakMap<Node, RustSourceValueContract>;
  readonly declarationByNode: WeakMap<Node, Node>;
}

export function collectRustSourceValueInventory(
  nodes: readonly Node[],
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): RustSourceValueInventory {
  const contracts = new WeakMap<Node, RustSourceValueContract>();
  const declarationByNode = new WeakMap<Node, Node>();
  for (const node of nodes) {
    const declaration = rustSourceValueDeclaration(node, input);
    if (declaration === undefined) continue;
    declarationByNode.set(node, declaration);
    const existing = contracts.get(declaration);
    if (existing !== undefined) {
      contracts.set(node, existing);
      continue;
    }
    const selected = rustSourceValueContractForDeclaration(declaration, input);
    if (selected.kind === "rejected") {
      diagnostics.push(rustOwnershipDiagnostic(
        selected.code,
        selected.message,
        declaration,
      ));
      continue;
    }
    if (selected.value !== undefined) {
      contracts.set(declaration, selected.value);
      contracts.set(node, selected.value);
    }
  }
  return Object.freeze({ contracts, declarationByNode });
}

export type RustSourceValueContractResult =
  | { readonly kind: "resolved"; readonly value?: RustSourceValueContract }
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };

export function rustSourceValueContractForDeclaration(
  declaration: Node,
  input: RustOwnershipAnalysisInput,
): RustSourceValueContractResult {
  const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (carrier === undefined) return { kind: "resolved" };
  const parameterAbi = input.facts.get(declaration, rustSourceParameterAbiFactKey) ??
    input.facts.resolve(declaration, rustSourceParameterAbiFactKey);
  const callableReturn = input.facts.get(declaration, rustSourceCallableReturnFactKey) ??
    input.facts.resolve(declaration, rustSourceCallableReturnFactKey);
  const sourceContract = parameterAbi?.sourceContract ?? callableReturn?.sourceContract ??
    rustSourceContractKindForType(Node_Type(input.ast, declaration), input);
  switch (sourceContract) {
    case "ordinary":
      return {
        kind: "resolved",
        value: Object.freeze({ kind: "ordinary-typescript", carrier }),
      };
    case "owned":
      return {
        kind: "resolved",
        value: Object.freeze({ kind: "owned", target: carrier }),
      };
    case "shared-reference":
    case "mutable-reference": {
      const referenceCarrier = parameterAbi?.parameterCarrier ??
        callableReturn?.returnCarrier ?? carrier;
      if (referenceCarrier.kind !== "reference" ||
        referenceCarrier.mutable !== (sourceContract === "mutable-reference")) {
        return {
          kind: "rejected",
          code: "RUST_SOURCE_REFERENCE_CONTRACT_CARRIER_MISMATCH",
          message: `Rust source contract '${sourceContract}' does not match its finalized runtime carrier.`,
        };
      }
      return {
        kind: "resolved",
        value: Object.freeze({
          kind: sourceContract,
          target: referenceCarrier.target,
          lifetime: referenceCarrier.lifetime,
        }),
      };
    }
  }
}

export function rustSourceValueDeclaration(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  return isRustSourceValueDeclarationKind(input.ast.kindName(node))
    ? node
    : input.navigation.sourceReferenceFor(node)?.declaration;
}

export function isRustSourceValueDeclarationKind(kind: string): boolean {
  return kind === "KindVariableDeclaration" || kind === "KindBindingElement" ||
    kind === "KindParameter" || kind === "KindPropertyDeclaration" ||
    kind === "KindPropertySignature" || kind === "KindFunctionDeclaration" ||
    kind === "KindFunctionExpression" || kind === "KindArrowFunction" ||
    kind === "KindMethodDeclaration" || kind === "KindMethodSignature" ||
    kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

function rustSourceContractKindForType(
  typeNode: Node | undefined,
  input: RustOwnershipAnalysisInput,
): import("../../target-model/operations/model.js").RustSourceParameterContract {
  const fact = input.facts.resolve(typeNode, rustSourceTypeContractFactKey) ??
    input.facts.get(typeNode, rustSourceTypeContractFactKey);
  return fact?.kind === "owned" || fact?.kind === "shared-reference" ||
      fact?.kind === "mutable-reference"
    ? fact.kind
    : "ordinary";
}
