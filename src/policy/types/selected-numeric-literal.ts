import type { Node } from "@tsonic/tsts";
import type { AstReader } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  sourceIntegerLiteralValue,
  KindMinusToken,
  KindPlusToken,
  Node_Operand,
} from "@tsonic/target-api/source";
import {
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../../target-model/operations/model.js";
import { rustNumericPromotionKind } from "../../target-model/conversions/numeric-promotion.js";

type SourcePrimitiveName = Extract<
  TargetTypeRef,
  { readonly kind: "source-primitive" }
>["name"];

export function selectedIntegerLiteralJoin(
  node: Node, carrier: TargetTypeRef | undefined, ast: AstReader,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "source-primitive" || sourceIntegerLiteralValue(ast, node) === undefined ||
    !["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"].includes(carrier.name)) return undefined;
  if (selectedSourceLiteralIsRepresentable(node, carrier.name, ast)) return carrier;
  for (const name of ["int32", "int64", "int128"] as const) {
    if (rustNumericPromotionKind(carrier.name, name) === name && selectedSourceLiteralIsRepresentable(node, name, ast)) {
      return { kind: "source-primitive", name };
    }
  }
  return undefined;
}

export function selectedSourceLiteralIsRepresentable(
  node: Node,
  primitive: SourcePrimitiveName,
  ast: AstReader,
): boolean {
  const kind = ast.kindName(node);
  if (primitive === "bool") {
    return kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
  }
  if (primitive === "float32" || primitive === "float64") {
    const value = selectedNumericLiteralValue(node, ast);
    return value !== undefined && Number.isFinite(value);
  }
  const value = sourceIntegerLiteralValue(ast, node);
  if (primitive === "native-int" || primitive === "native-uint") {
    return value !== undefined && (primitive === "native-int" || value >= 0n);
  }
  const ranges: Readonly<Partial<Record<SourcePrimitiveName, readonly [bigint, bigint]>>> = {
    int8: [-128n, 127n],
    uint8: [0n, 255n],
    int16: [-32768n, 32767n],
    uint16: [0n, 65535n],
    int32: [-2147483648n, 2147483647n],
    uint32: [0n, 4294967295n],
    int64: [-9223372036854775808n, 9223372036854775807n],
    uint64: [0n, 18446744073709551615n],
    int128: [
      -170141183460469231731687303715884105728n,
      170141183460469231731687303715884105727n,
    ],
    uint128: [0n, 340282366920938463463374607431768211455n],
  };
  const range = ranges[primitive];
  return value !== undefined && range !== undefined && value >= range[0] && value <= range[1];
}

export function selectedSourceLiteralOperandIsRepresentable(
  node: Node,
  primitive: SourcePrimitiveName,
  ast: AstReader,
): boolean {
  const parent = ast.parent(node);
  return parent !== undefined &&
    ast.kindName(parent) === "KindPrefixUnaryExpression" &&
    Node_Operand(ast, parent) === node &&
    selectedSourceLiteralIsRepresentable(parent, primitive, ast);
}

export function selectedSourceNumericLiteralOperationId(
  node: Node,
  ast: AstReader,
): string | undefined {
  if (ast.kindName(node) !== "KindPrefixUnaryExpression") {
    return undefined;
  }
  const operatorKind = ast.operatorKindName(node);
  return operatorKind === KindMinusToken
    ? rustPostCheckUnaryMinusOperationId
    : operatorKind === KindPlusToken
      ? rustPostCheckUnaryPlusOperationId
      : undefined;
}

function selectedNumericLiteralValue(
  node: Node,
  ast: AstReader,
): number | undefined {
  const kind = ast.kindName(node);
  if (kind === "KindNumericLiteral") {
    const value = Number(ast.text(node));
    return Number.isFinite(value) ? value : undefined;
  }
  if (kind !== "KindPrefixUnaryExpression") {
    return undefined;
  }
  const operationId = selectedSourceNumericLiteralOperationId(node, ast);
  const sign = operationId === rustPostCheckUnaryMinusOperationId
    ? -1
    : operationId === rustPostCheckUnaryPlusOperationId
      ? 1
      : undefined;
  if (sign === undefined) {
    return undefined;
  }
  const operand = Node_Operand(ast, node);
  if (operand === undefined || ast.kindName(operand) !== "KindNumericLiteral") {
    return undefined;
  }
  const value = Number(ast.text(operand));
  return Number.isFinite(value) ? sign * value : undefined;
}
