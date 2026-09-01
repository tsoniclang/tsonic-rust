import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  KindBinaryExpression,
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import type {
  RustValueConversionContract,
} from "../../../target-model/conversions/contracts.js";
import type { RustPlanQueries } from "../../../target-model/facts/selections.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function markBinaryProjectIdentityUsed(
  node: Node,
  input: {
    readonly ast: AstReader;
    readonly facts: RustPlanQueries;
  },
  mark: (carrier: TargetTypeRef | undefined) => void,
): void {
  if (input.ast.kindName(node) !== KindBinaryExpression) return;
  mark(input.facts.getRuntimeCarrierFact(BinaryExpression_Left(input.ast, node))?.carrier);
  mark(input.facts.getRuntimeCarrierFact(BinaryExpression_Right(input.ast, node))?.carrier);
}

export function isRustPreconstructionThisOperation(ast: AstReader, node: Node): boolean {
  if (!isInsideRustPreconstruction(ast, node)) return false;
  const expression = Node_Expression(ast, node);
  const receiver = ast.kindName(node) === KindPropertyAccessExpression
    ? expression
    : expression !== undefined && ast.kindName(expression) === KindPropertyAccessExpression
      ? Node_Expression(ast, expression)
      : expression !== undefined &&
          (ast.kindName(expression) === "KindSuperKeyword" ||
            ast.kindName(expression) === "KindSuperExpression")
        ? expression
        : undefined;
  const kind = receiver === undefined ? "" : ast.kindName(receiver);
  return kind === "KindThisExpression" || kind === "KindThisKeyword" ||
    kind === "KindSuperKeyword" || kind === "KindSuperExpression";
}

function isInsideRustPreconstruction(ast: AstReader, node: Node): boolean {
  let current = ast.parent(node);
  while (current !== undefined) {
    switch (ast.kindName(current)) {
      case "KindConstructor":
        return true;
      case "KindPropertyDeclaration":
        return !ast.hasModifierKind(current, "static");
      case "KindFunctionDeclaration":
      case "KindFunctionExpression":
      case "KindMethodDeclaration":
      case "KindMethodSignature":
      case "KindGetAccessor":
      case "KindSetAccessor":
      case "KindClassDeclaration":
      case "KindClassExpression":
      case "KindSourceFile":
        return false;
    }
    current = ast.parent(current);
  }
  return false;
}

export function structuralFieldKey(carrier: TargetTypeRef, storageIndex: number): string {
  return `${closedMetadataKey(carrier)}#${storageIndex}`;
}

export function visitConversionContract(
  contract: RustValueConversionContract,
  markStructuralFieldRead: (carrier: TargetTypeRef, storageIndex: number) => void,
  markVariantConstructed: (carrier: TargetTypeRef, variantName: string) => void,
): void {
  switch (contract.lowering) {
    case "source-union-variant":
      markVariantConstructed(contract.target, contract.variantName);
      return;
    case "option-map":
      visitConversionContract(contract.element, markStructuralFieldRead, markVariantConstructed);
      return;
    case "js-value-from-option":
    case "js-value-from-array":
      visitConversionContract(
        contract.elementConversion,
        markStructuralFieldRead,
        markVariantConstructed,
      );
      return;
    case "js-value-from-source-union":
      for (const variant of contract.variants) {
        visitConversionContract(
          variant.conversion,
          markStructuralFieldRead,
          markVariantConstructed,
        );
      }
      return;
    case "js-value-from-structural-to-json":
      markStructuralFieldRead(contract.source, contract.storageIndex);
      visitConversionContract(
        contract.resultConversion,
        markStructuralFieldRead,
        markVariantConstructed,
      );
      return;
    case "js-value-from-structural-object":
      for (const field of contract.fields) {
        markStructuralFieldRead(contract.source, field.storageIndex);
        visitConversionContract(
          field.conversion,
          markStructuralFieldRead,
          markVariantConstructed,
        );
      }
      return;
    case "call":
    case "numeric-cast":
    case "identity":
    case "option-some":
    case "js-argument-vector-callback":
    case "owned-string-from-borrowed-str":
    case "copy-from-reference":
      return;
  }
}
