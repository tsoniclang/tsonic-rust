import type { Node } from "@tsonic/tsts";
import type { AstReader } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  KindBigIntLiteral,
  KindMinusToken,
  KindPlusToken,
  Node_Operand,
} from "@tsonic/target-api/source";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
} from "../../target-model/syntax/literals.js";
import {
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../../target-model/operations/model.js";

type SourcePrimitiveName = Extract<
  TargetTypeRef,
  { readonly kind: "source-primitive" }
>["name"];

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
  const value = selectedIntegerLiteralValue(node, ast);
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
    "native-int": [-32768n, 32767n],
    "native-uint": [0n, 65535n],
  };
  const range = ranges[primitive];
  const requiresExactNumberProof = primitive === "int64" || primitive === "uint64" ||
    primitive === "int128" || primitive === "uint128";
  return value !== undefined && range !== undefined && value >= range[0] && value <= range[1] &&
    (!requiresExactNumberProof || selectedIntegerLiteralIsExact(node, ast));
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

function selectedIntegerLiteralValue(
  node: Node,
  ast: AstReader,
): bigint | undefined {
  const kind = ast.kindName(node);
  if (kind === "KindNumericLiteral") {
    return parseSourceIntegerLiteral(ast.text(node));
  }
  if (kind === KindBigIntLiteral) {
    return parseSourceBigIntLiteral(ast.text(node));
  }
  if (kind !== "KindPrefixUnaryExpression") {
    return undefined;
  }
  const operationId = selectedSourceNumericLiteralOperationId(node, ast);
  const sign = operationId === rustPostCheckUnaryMinusOperationId
    ? -1n
    : operationId === rustPostCheckUnaryPlusOperationId
      ? 1n
      : undefined;
  const operand = Node_Operand(ast, node);
  if (sign === undefined || operand === undefined) {
    return undefined;
  }
  const operandKind = ast.kindName(operand);
  const value = operandKind === "KindNumericLiteral"
    ? parseSourceIntegerLiteral(ast.text(operand))
    : operandKind === KindBigIntLiteral
      ? parseSourceBigIntLiteral(ast.text(operand))
      : undefined;
  return value === undefined ? undefined : sign * value;
}

function selectedIntegerLiteralIsExact(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  if (kind === KindBigIntLiteral) {
    return parseSourceBigIntLiteral(ast.text(node)) !== undefined;
  }
  if (kind === "KindNumericLiteral") {
    const value = parseSourceIntegerLiteral(ast.text(node));
    return value !== undefined && value <= BigInt(Number.MAX_SAFE_INTEGER);
  }
  if (kind !== "KindPrefixUnaryExpression") {
    return false;
  }
  const operand = Node_Operand(ast, node);
  if (operand === undefined) {
    return false;
  }
  if (ast.kindName(operand) === KindBigIntLiteral) {
    return parseSourceBigIntLiteral(ast.text(operand)) !== undefined;
  }
  if (ast.kindName(operand) !== "KindNumericLiteral") {
    return false;
  }
  const value = parseSourceIntegerLiteral(ast.text(operand));
  return value !== undefined && value <= BigInt(Number.MAX_SAFE_INTEGER);
}
