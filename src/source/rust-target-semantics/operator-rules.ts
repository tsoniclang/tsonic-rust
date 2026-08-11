import type { TargetTypeRef } from "../../policy/types.js";
import type { RustValueConversion } from "../rust-facts/keys.js";
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
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustJsStrictEqualityCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustSourcePrimitiveTargetType,
  sameRustPrimitiveCarrier,
} from "../rust-target-types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { rustSourceTypeCarrierValue } from "../rust-target-types.js";
import { selectRustNumericBinaryPromotion } from "./numeric-promotion.js";

export interface RustBinaryOperatorSelection {
  readonly kind: "operator-token" | "string-concat";
  readonly rustOperator: RustBinaryOperator;
  readonly resultCarrier: TargetTypeRef;
  readonly leftConversion?: RustValueConversion;
  readonly rightConversion?: RustValueConversion;
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

function sameRustArithmeticCarrier(left: TargetTypeRef, right: TargetTypeRef): boolean {
  return (isRustNumericCarrier(left) && sameRustPrimitiveCarrier(left, right)) ||
    (isRustBigIntCarrier(left) && isRustBigIntCarrier(right));
}

function rustArithmeticOperatorHasDirectSemantics(
  operator: RustOperatorToken,
  left: TargetTypeRef,
): boolean {
  return !isRustBigIntCarrier(left) || (operator !== "/" && operator !== "%");
}

function compoundBinaryOperator(
  operator: RustAssignmentOperator,
): RustBinaryOperator | undefined {
  switch (operator) {
    case "+=":
      return "+";
    case "-=":
      return "-";
    case "*=":
      return "*";
    case "/=":
      return "/";
    case "%=":
      return "%";
    default:
      return undefined;
  }
}

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
    const promotion = selectRustNumericBinaryPromotion(left, right);
    if (promotion !== undefined &&
      rustArithmeticOperatorHasDirectSemantics(arithmetic, promotion.carrier)) {
      return {
        kind: "operator-token",
        rustOperator: arithmetic,
        resultCarrier: promotion.carrier,
        leftConversion: promotion.leftConversion,
        rightConversion: promotion.rightConversion,
      };
    }
    if (isRustBigIntCarrier(left) && isRustBigIntCarrier(right) &&
      rustArithmeticOperatorHasDirectSemantics(arithmetic, left)) {
      return { kind: "operator-token", rustOperator: arithmetic, resultCarrier: left };
    }
    return undefined;
  }
  const comparison = comparisonTokens[operatorKindName];
  if (comparison !== undefined) {
    const promotion = selectRustNumericBinaryPromotion(left, right);
    if (promotion !== undefined) {
      return {
        kind: "operator-token",
        rustOperator: comparison,
        resultCarrier: boolCarrier,
        leftConversion: promotion.leftConversion,
        rightConversion: promotion.rightConversion,
      };
    }
    return isRustBigIntCarrier(left) && isRustBigIntCarrier(right)
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
    const sameObject = leftEnum !== undefined && rightEnum !== undefined &&
      leftEnum.shape === "object" && rightEnum.shape === "object" &&
      leftEnum.fileName === rightEnum.fileName && leftEnum.typeName === rightEnum.typeName;
    const numericPromotion = selectRustNumericBinaryPromotion(left, right);
    const comparable =
      numericPromotion !== undefined ||
      (isRustBigIntCarrier(left) && isRustBigIntCarrier(right)) ||
      (isRustBoolCarrier(left) && isRustBoolCarrier(right)) ||
      (isRustStringCarrier(left) && isRustStringCarrier(right)) ||
      (isRustJsStrictEqualityCarrier(left) && rustTargetTypeRefEquals(left, right)) ||
      sameEnum || sameObject;
    return comparable
      ? {
          kind: "operator-token",
          rustOperator: equality,
          resultCarrier: boolCarrier,
          leftConversion: numericPromotion?.leftConversion,
          rightConversion: numericPromotion?.rightConversion,
        }
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
  const binaryOperator = compoundBinaryOperator(operator);
  if (operator === "+=" && isRustStringCarrier(left) && isRustStringCarrier(right)) {
    return operator;
  }
  return binaryOperator !== undefined && sameRustArithmeticCarrier(left, right) &&
      rustArithmeticOperatorHasDirectSemantics(binaryOperator, left)
    ? operator
    : undefined;
}

export function selectRustEquivalentAssignment(
  operator: RustOperatorToken,
  target: TargetTypeRef | undefined,
  result: TargetTypeRef | undefined,
): RustAssignmentOperator | undefined {
  if (target === undefined || result === undefined ||
    !sameRustArithmeticCarrier(target, result) ||
    !rustArithmeticOperatorHasDirectSemantics(operator, target)) {
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
