import type { Node } from "@tsonic/tsts";
import type { AstReader } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  KindMinusToken,
  KindPlusToken,
  Node_Operand,
} from "../../common/source-ast.js";
import {
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../rust-facts/keys.js";

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
  const value = selectedNumericLiteralValue(node, ast);
  if (value === undefined) {
    return false;
  }
  if (primitive === "float32" || primitive === "float64") {
    return true;
  }
  if (!Number.isInteger(value)) {
    return false;
  }
  const ranges: Readonly<Partial<Record<SourcePrimitiveName, readonly [number, number]>>> = {
    int8: [-128, 127],
    uint8: [0, 255],
    int16: [-32768, 32767],
    uint16: [0, 65535],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
  };
  const range = ranges[primitive];
  return range !== undefined && value >= range[0] && value <= range[1];
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
