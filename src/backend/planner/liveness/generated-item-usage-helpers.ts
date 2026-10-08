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
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { isRustAssignmentOperator } from "../../../target-model/syntax/tokens.js";

export function isRustArrayFieldContentAssignment(node: Node, ast: AstReader, facts: RustPlanQueries): boolean {
  let current = node;
  let parent = ast.parent(current);
  let indexed = false;
  while (parent !== undefined &&
    (ast.kindName(parent) === "KindParenthesizedExpression" || ast.kindName(parent) === "KindElementAccessExpression") &&
    Node_Expression(ast, parent) === current) {
    indexed ||= ast.kindName(parent) === "KindElementAccessExpression";
    current = parent;
    parent = ast.parent(current);
  }
  if (!indexed || parent === undefined || ast.kindName(parent) !== KindBinaryExpression ||
    BinaryExpression_Left(ast, parent) !== current) return false;
  const operation = facts.getFact(parent, rustTargetOperationFactKey);
  return (operation?.kind === "operator-token" || operation?.kind === "operator-call") &&
    isRustAssignmentOperator(operation.operator);
}

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
  usage: {
    readonly structuralFieldRead: (carrier: TargetTypeRef, storageIndex: number) => void;
    readonly variantRead: (carrier: TargetTypeRef, variantName: string) => void;
    readonly variantConstructed: (carrier: TargetTypeRef, variantName: string) => void;
    readonly closedObjectUsed: (carrier: TargetTypeRef) => void;
  },
): void {
  switch (contract.lowering) {
    case "project-closed-value":
      usage.closedObjectUsed(contract.source);
      return;
    case "rest-sequence":
      for (const conversion of contract.elementConversions) {
        if (conversion !== null) visitConversionContract(conversion, usage);
      }
      return;
    case "source-union-variant":
      for (const step of contract.path) usage.variantConstructed(step.union, step.variant.name);
      if (contract.payloadConversion !== null) {
        visitConversionContract(contract.payloadConversion, usage);
      }
      return;
    case "union-map":
      for (const arm of contract.arms) {
        for (const step of arm.source) usage.variantRead(step.union, step.variant.name);
        for (const step of arm.target) usage.variantConstructed(step.union, step.variant.name);
      }
      return;
    case "option-map":
      visitConversionContract(contract.element, usage);
      return;
    case "closed-value-from-option":
    case "js-value-from-array":
      visitConversionContract(contract.elementConversion, usage);
      return;
    case "union-fold":
      for (const arm of contract.arms) {
        for (const step of arm.path) usage.variantRead(step.union, step.variant.name);
        visitConversionContract(arm.conversion, usage);
      }
      return;
    case "js-value-from-structural-to-json":
      usage.structuralFieldRead(contract.source, contract.storageIndex);
      visitConversionContract(contract.resultConversion, usage);
      return;
    case "js-value-from-properties":
      for (const field of contract.fields) visitConversionContract(field.conversion, usage);
      return;
    case "js-value-from-structural-object":
      for (const field of contract.fields) {
        usage.structuralFieldRead(contract.source, field.storageIndex);
        visitConversionContract(field.conversion, usage);
      }
      return;
    case "program-error-closed-value":
    case "call":
    case "exact-integer":
    case "numeric-cast":
    case "identity":
    case "js-argument-vector-callback":
    case "owned-string-from-borrowed-str":
    case "copy-from-reference":
      return;
    case "union-project":
      for (const step of contract.path) usage.variantRead(step.union, step.variant.name);
      return;
    case "option-some":
      if (contract.element !== null) visitConversionContract(contract.element, usage);
      return;
  }
}
