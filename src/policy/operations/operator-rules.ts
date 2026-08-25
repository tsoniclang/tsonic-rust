import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTypeSemanticKey } from "../../target-model/semantics/index.js";
import type { RustArgumentMode, RustValueConversion } from "../../target-model/operations/model.js";
import type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustOperationSymbol,
  RustOperatorToken,
} from "../../target-model/syntax/tokens.js";
import {
  KindAmpersandToken,
  KindAmpersandAmpersandToken,
  KindAsteriskEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  KindAsteriskToken,
  KindBarToken,
  KindBarBarToken,
  KindCaretToken,
  KindEqualsToken,
  KindEqualsEqualsEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindGreaterThanEqualsToken,
  KindGreaterThanGreaterThanGreaterThanToken,
  KindGreaterThanGreaterThanToken,
  KindGreaterThanToken,
  KindLessThanLessThanToken,
  KindLessThanEqualsToken,
  KindLessThanToken,
  KindMinusToken,
  KindPercentToken,
  KindPlusToken,
  KindSlashToken,
} from "@tsonic/target-api/source";
import {
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustJsStrictEqualityCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustSourcePrimitiveTargetType,
  rustStructuralObjectCarrierValue,
  sameRustPrimitiveCarrier,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import {
  type RustNumericBinaryPromotion,
  rustNumericPromotionConversion,
  selectRustNumericBinaryPromotion,
} from "./numeric-promotion.js";

export type RustBinaryOperatorSelection =
  | {
      readonly kind: "operator-token";
      readonly rustOperator: RustBinaryOperator;
      readonly resultCarrier: TargetTypeRef;
      readonly leftConversion?: RustValueConversion;
      readonly rightConversion?: RustValueConversion;
    }
  | {
      readonly kind: "operator-call";
      readonly rustOperator: RustOperationSymbol;
      readonly resultCarrier: TargetTypeRef;
      readonly path: string;
      readonly fallible: boolean;
      readonly operandModes: readonly [RustArgumentMode, RustArgumentMode];
      readonly leftConversion?: RustValueConversion;
      readonly rightConversion?: RustValueConversion;
    }
  | {
      readonly kind: "string-concat";
      readonly rustOperator: "+";
      readonly resultCarrier: TargetTypeRef;
    };

export type RustCompoundAssignmentSelection =
  | {
      readonly kind: "operator-token";
      readonly operator: RustAssignmentOperator;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "operator-call";
      readonly operator: RustAssignmentOperator;
      readonly path: string;
      readonly resultCarrier: TargetTypeRef;
      readonly fallible: boolean;
      readonly operandModes: readonly [RustArgumentMode, RustArgumentMode];
    };

const bigintArithmeticCallByOperator: Readonly<Partial<Record<RustBinaryOperator, string>>> = {
  "/": "rt::BigInt::checked_div",
  "%": "rt::BigInt::checked_rem",
};

const arithmeticTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindPlusToken]: "+",
  [KindMinusToken]: "-",
  [KindAsteriskToken]: "*",
  [KindSlashToken]: "/",
  [KindPercentToken]: "%",
};

const bitwiseTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindAmpersandToken]: "&",
  [KindBarToken]: "|",
  [KindCaretToken]: "^",
};

const shiftOperations: Readonly<Record<string, {
  readonly operator: RustOperationSymbol;
  readonly nativePath: string;
  readonly sourceNumberPath: string;
}>> = {
  [KindLessThanLessThanToken]: {
    operator: "<<",
    nativePath: "rt::native_shift_left",
    sourceNumberPath: "rt::source_number_shift_left",
  },
  [KindGreaterThanGreaterThanToken]: {
    operator: ">>",
    nativePath: "rt::native_shift_right",
    sourceNumberPath: "rt::source_number_shift_right",
  },
  [KindGreaterThanGreaterThanGreaterThanToken]: {
    operator: ">>>",
    nativePath: "rt::native_unsigned_shift_right",
    sourceNumberPath: "rt::source_number_unsigned_shift_right",
  },
};

const sourceNumberBitwisePaths: Readonly<Record<RustBinaryOperator, string | undefined>> = {
  "+": undefined,
  "-": undefined,
  "*": undefined,
  "/": undefined,
  "%": undefined,
  "&": "rt::source_number_bitwise_and",
  "|": "rt::source_number_bitwise_or",
  "^": "rt::source_number_bitwise_xor",
  "<<": undefined,
  ">>": undefined,
  "<": undefined,
  "<=": undefined,
  ">": undefined,
  ">=": undefined,
  "==": undefined,
  "!=": undefined,
  "&&": undefined,
  "||": undefined,
};

const comparisonTokens: Readonly<Record<string, RustBinaryOperator>> = {
  [KindLessThanToken]: "<",
  [KindLessThanEqualsToken]: "<=",
  [KindGreaterThanToken]: ">",
  [KindGreaterThanEqualsToken]: ">=",
};

const sourceStringComparisonPathByOperator: Readonly<Record<string, string>> = {
  "<": "rt::source_string_less_than",
  "<=": "rt::source_string_less_than_or_equal",
  ">": "rt::source_string_greater_than",
  ">=": "rt::source_string_greater_than_or_equal",
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

function isRustSourceNumberCarrier(carrier: TargetTypeRef): boolean {
  return carrier.kind === "source-primitive" && carrier.name === "float64";
}

function selectRustSourceNumberOperands(
  left: TargetTypeRef,
  right: TargetTypeRef,
): RustNumericBinaryPromotion | undefined {
  if (
    !isRustSourceNumberCarrier(left) &&
    !isRustSourceNumberCarrier(right)
  ) {
    return undefined;
  }
  const promotion = selectRustNumericBinaryPromotion(left, right);
  return promotion !== undefined && isRustSourceNumberCarrier(promotion.carrier)
    ? promotion
    : undefined;
}

function selectRustIntegralShiftPromotion(
  carrier: TargetTypeRef,
): { readonly carrier: TargetTypeRef; readonly conversion?: RustValueConversion } | undefined {
  if (!isRustIntegerCarrier(carrier)) {
    return undefined;
  }
  const promotedKind = carrier.name === "int8" || carrier.name === "uint8" ||
      carrier.name === "int16" || carrier.name === "uint16"
    ? "int32"
    : carrier.name;
  const promoted = rustSourcePrimitiveTargetType(promotedKind);
  const conversion = rustNumericPromotionConversion(carrier.name, promotedKind);
  return {
    carrier: promoted,
    ...(conversion === undefined ? {} : { conversion }),
  };
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
  "&": KindAmpersandToken,
  "|": KindBarToken,
  "^": KindCaretToken,
  "<<": KindLessThanLessThanToken,
  ">>": KindGreaterThanGreaterThanToken,
  ">>>": KindGreaterThanGreaterThanGreaterThanToken,
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

export function rustBinaryRightCarrierIsIndependentOfLeft(
  operatorKindOrText: string,
): boolean {
  const operatorKind = operatorKindByText[operatorKindOrText] ?? operatorKindOrText;
  return shiftOperations[operatorKind] !== undefined;
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
    if (isRustBigIntCarrier(left) && isRustBigIntCarrier(right)) {
      const path = bigintArithmeticCallByOperator[arithmetic];
      if (path !== undefined) {
        return {
          kind: "operator-call",
          rustOperator: arithmetic,
          resultCarrier: left,
          path,
          fallible: true,
          operandModes: ["value", "value"],
        };
      }
    }
    return undefined;
  }
  const bitwise = bitwiseTokens[operatorKindName];
  if (bitwise !== undefined) {
    const sourceNumberOperands = selectRustSourceNumberOperands(left, right);
    if (sourceNumberOperands !== undefined) {
      return {
        kind: "operator-call",
        rustOperator: bitwise,
        resultCarrier: sourceNumberOperands.carrier,
        path: sourceNumberBitwisePaths[bitwise]!,
        fallible: false,
        operandModes: ["value", "value"],
        leftConversion: sourceNumberOperands.leftConversion,
        rightConversion: sourceNumberOperands.rightConversion,
      };
    }
    const promotion = selectRustNumericBinaryPromotion(left, right);
    return promotion !== undefined && isRustIntegerCarrier(promotion.carrier)
      ? {
          kind: "operator-token",
          rustOperator: bitwise,
          resultCarrier: promotion.carrier,
          leftConversion: promotion.leftConversion,
          rightConversion: promotion.rightConversion,
        }
      : undefined;
  }
  const shift = shiftOperations[operatorKindName];
  if (shift !== undefined) {
    const sourceNumberOperands = selectRustSourceNumberOperands(left, right);
    if (sourceNumberOperands !== undefined) {
      return {
        kind: "operator-call",
        rustOperator: shift.operator,
        resultCarrier: sourceNumberOperands.carrier,
        path: shift.sourceNumberPath,
        fallible: false,
        operandModes: ["value", "value"],
        leftConversion: sourceNumberOperands.leftConversion,
        rightConversion: sourceNumberOperands.rightConversion,
      };
    }
    const promotion = selectRustIntegralShiftPromotion(left);
    return promotion !== undefined && isRustIntegerCarrier(right)
      ? {
          kind: "operator-call",
          rustOperator: shift.operator,
          resultCarrier: promotion.carrier,
          path: shift.nativePath,
          fallible: false,
          operandModes: ["value", "value"],
          leftConversion: promotion.conversion,
        }
      : undefined;
  }
  const comparison = comparisonTokens[operatorKindName];
  if (comparison !== undefined) {
    if (isRustStringCarrier(left) && isRustStringCarrier(right)) {
      return {
        kind: "operator-call",
        rustOperator: comparison,
        resultCarrier: boolCarrier,
        path: sourceStringComparisonPathByOperator[comparison]!,
        fallible: false,
        operandModes: ["ref", "ref"],
      };
    }
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
    const sameStructuralObject = rustStructuralObjectCarrierValue(left) !== undefined &&
      rustStructuralObjectCarrierValue(right) !== undefined &&
      rustTargetTypeRefEquals(left, right);
    const numericPromotion = selectRustNumericBinaryPromotion(left, right);
    const comparable =
      numericPromotion !== undefined ||
      (isRustBigIntCarrier(left) && isRustBigIntCarrier(right)) ||
      (isRustBoolCarrier(left) && isRustBoolCarrier(right)) ||
      (isRustStringCarrier(left) && isRustStringCarrier(right)) ||
      (isRustJsStrictEqualityCarrier(left) && rustTargetTypeRefEquals(left, right)) ||
      sameEnum || sameObject || sameStructuralObject;
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
): RustCompoundAssignmentSelection | undefined {
  operatorKindName = operatorKindByText[operatorKindName] ?? operatorKindName;
  const operator = compoundAssignmentTokens[operatorKindName];
  if (operator === undefined || left === undefined || right === undefined) {
    return undefined;
  }
  const binaryOperator = compoundBinaryOperator(operator);
  if (operator === "+=" && isRustStringCarrier(left) && isRustStringCarrier(right)) {
    return { kind: "operator-token", operator, resultCarrier: left };
  }
  if (binaryOperator === undefined || !sameRustArithmeticCarrier(left, right)) {
    return undefined;
  }
  if (rustArithmeticOperatorHasDirectSemantics(binaryOperator, left)) {
    return { kind: "operator-token", operator, resultCarrier: left };
  }
  const path = bigintArithmeticCallByOperator[binaryOperator];
  return isRustBigIntCarrier(left) && path !== undefined
    ? {
        kind: "operator-call",
        operator,
        path,
        resultCarrier: left,
        fallible: true,
        operandModes: ["value", "value"],
      }
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
  return rustTypeSemanticKey(carrier);
}
