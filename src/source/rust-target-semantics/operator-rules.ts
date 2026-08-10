import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustOperatorToken,
} from "../../common/rust-syntax.js";
import {
  KindAmpersandAmpersandToken,
  KindAsteriskEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  KindAsteriskToken,
  KindBarBarToken,
  KindEqualsToken,
  KindEqualsEqualsEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindGreaterThanEqualsToken,
  KindGreaterThanToken,
  KindLessThanEqualsToken,
  KindLessThanToken,
  KindMinusToken,
  KindPercentToken,
  KindPlusToken,
  KindSlashToken,
} from "../../common/source-ast.js";
import {
  isRustBoolCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustSourcePrimitiveTargetType,
  sameRustPrimitiveCarrier,
} from "../rust-target-types.js";
import { rustSourceTypeCarrierValue } from "../rust-facts/keys.js";

export interface RustBinaryOperatorSelection {
  readonly kind: "operator-token" | "string-concat";
  readonly rustOperator: RustBinaryOperator;
  readonly resultCarrier: TargetTypeRef;
}

const arithmeticTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindPlusToken]: "+",
  [KindMinusToken]: "-",
  [KindAsteriskToken]: "*",
  [KindSlashToken]: "/",
  [KindPercentToken]: "%",
};

const comparisonTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindLessThanToken]: "<",
  [KindLessThanEqualsToken]: "<=",
  [KindGreaterThanToken]: ">",
  [KindGreaterThanEqualsToken]: ">=",
};

const equalityTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindEqualsEqualsEqualsToken]: "==",
  [KindExclamationEqualsEqualsToken]: "!=",
};

const logicalTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindAmpersandAmpersandToken]: "&&",
  [KindBarBarToken]: "||",
};

const boolCarrier = rustSourcePrimitiveTargetType("bool");

const operatorKindByText: Readonly<Record<string, string>> = {
  "+": KindPlusToken,
  "-": KindMinusToken,
  "*": KindAsteriskToken,
  "/": KindSlashToken,
  "%": KindPercentToken,
  "<": KindLessThanToken,
  "<=": KindLessThanEqualsToken,
  ">": KindGreaterThanToken,
  ">=": KindGreaterThanEqualsToken,
  "===": KindEqualsEqualsEqualsToken,
  "!==": KindExclamationEqualsEqualsToken,
  "&&": KindAmpersandAmpersandToken,
  "||": KindBarBarToken,
  "+=": KindPlusEqualsToken,
  "-=": KindMinusEqualsToken,
  "*=": KindAsteriskEqualsToken,
  "/=": KindSlashEqualsToken,
  "%=": KindPercentEqualsToken,
};

export function rustBinaryResultCarrierIsIndependentOfOperands(
  operatorKindOrText: string,
): boolean {
  const operatorKind = operatorKindByText[operatorKindOrText] ?? operatorKindOrText;
  return comparisonTokens[operatorKind] !== undefined || equalityTokens[operatorKind] !== undefined;
}

export function selectRustBinaryOperator(
  operatorKindName: string,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
): RustBinaryOperatorSelection | undefined {
  operatorKindName = operatorKindByText[operatorKindName] ?? operatorKindName;
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const arithmetic = arithmeticTokens[operatorKindName];
  if (arithmetic !== undefined) {
    if (operatorKindName === KindPlusToken && isRustStringCarrier(left) && isRustStringCarrier(right)) {
      return { kind: "string-concat", rustOperator: "+", resultCarrier: left };
    }
    if (isRustNumericCarrier(left) && sameRustPrimitiveCarrier(left, right)) {
      return { kind: "operator-token", rustOperator: arithmetic, resultCarrier: left };
    }
    return undefined;
  }
  const comparison = comparisonTokens[operatorKindName];
  if (comparison !== undefined) {
    return isRustNumericCarrier(left) && sameRustPrimitiveCarrier(left, right)
      ? { kind: "operator-token", rustOperator: comparison, resultCarrier: boolCarrier }
      : undefined;
  }
  const equality = equalityTokens[operatorKindName];
  if (equality !== undefined) {
    const leftEnum = rustSourceTypeCarrierValue(left);
    const rightEnum = rustSourceTypeCarrierValue(right);
    const sameEnum = leftEnum !== undefined && rightEnum !== undefined &&
      leftEnum.shape === "enum" && rightEnum.shape === "enum" &&
      leftEnum.fileName === rightEnum.fileName && leftEnum.typeName === rightEnum.typeName;
    const comparable =
      (isRustNumericCarrier(left) && sameRustPrimitiveCarrier(left, right)) ||
      (isRustBoolCarrier(left) && isRustBoolCarrier(right)) ||
      (isRustStringCarrier(left) && isRustStringCarrier(right)) ||
      sameEnum;
    return comparable
      ? { kind: "operator-token", rustOperator: equality, resultCarrier: boolCarrier }
      : undefined;
  }
  const logical = logicalTokens[operatorKindName];
  if (logical !== undefined) {
    return isRustBoolCarrier(left) && isRustBoolCarrier(right)
      ? { kind: "operator-token", rustOperator: logical, resultCarrier: boolCarrier }
      : undefined;
  }
  return undefined;
}

const compoundAssignmentTokens: Readonly<Record<string, RustAssignmentOperator>> = {
  [KindPlusEqualsToken]: "+=",
  [KindMinusEqualsToken]: "-=",
  [KindAsteriskEqualsToken]: "*=",
  [KindSlashEqualsToken]: "/=",
  [KindPercentEqualsToken]: "%=",
};

export function isRustAssignmentOperator(operatorKindOrText: string): boolean {
  const operatorKind = operatorKindByText[operatorKindOrText] ?? operatorKindOrText;
  return operatorKind === KindEqualsToken || compoundAssignmentTokens[operatorKind] !== undefined;
}

export function selectRustCompoundAssignment(
  operatorKindName: string,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
): RustAssignmentOperator | undefined {
  operatorKindName = operatorKindByText[operatorKindName] ?? operatorKindName;
  const operator = compoundAssignmentTokens[operatorKindName];
  if (operator === undefined || left === undefined || right === undefined) {
    return undefined;
  }
  return isRustNumericCarrier(left) && sameRustPrimitiveCarrier(left, right) ? operator : undefined;
}

export function selectRustEquivalentAssignment(
  operator: RustOperatorToken,
  target: TargetTypeRef | undefined,
  result: TargetTypeRef | undefined,
): RustAssignmentOperator | undefined {
  if (target === undefined || result === undefined || !isRustNumericCarrier(target) ||
    !sameRustPrimitiveCarrier(target, result)) {
    return undefined;
  }
  switch (operator) {
    case "+":
      return "+=";
    case "-":
      return "-=";
    case "*":
      return "*=";
    case "/":
      return "/=";
    case "%":
      return "%=";
    default:
      return undefined;
  }
}

export function rustOperatorCarrierKey(carrier: TargetTypeRef): string {
  if (carrier.kind === "source-primitive") {
    return carrier.name;
  }
  if (carrier.kind === "target-named") {
    return carrier.id;
  }
  return carrier.kind;
}
