import type { Node } from "@tsonic/tsts";
import type { AstReader } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  compareSourceNumericLiteralMagnitude,
  type SourceLiteralIndex,
  type SourceLiteralValue,
  KindMinusToken,
  KindPlusToken,
  Node_Operand,
} from "@tsonic/target-api/source";
import {
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../../../target-model/operations/model.js";
import { rustNumericPromotionKind } from "../../../target-model/conversions/numeric-promotion.js";
import { rustUnionLeaves } from "../../../target-model/types/union-relations.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { isRustNumericCarrier } from "../../../target-model/types/carriers/primitives.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

type SourcePrimitiveName = Extract<
  TargetTypeRef,
  { readonly kind: "source-primitive" }
>["name"];

const rustFloat32OverflowMidpoint = (1n << 128n) - (1n << 103n);

export function isRustNumericLiteralCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "source-primitive" }> {
  return carrier?.kind === "source-primitive" &&
    (carrier.name === "float16" || isRustNumericCarrier(carrier));
}

export function isUnannotatedRustNumericLiteral(literal: SourceLiteralValue | undefined): boolean {
  return literal?.numeric !== undefined && literal.number !== undefined || literal?.integer !== undefined;
}

export function selectedIntegerLiteralJoin(
  literal: SourceLiteralValue | undefined, carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "source-primitive" || literal?.integer === undefined ||
    !["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"].includes(carrier.name)) return undefined;
  if (selectedSourceLiteralIsRepresentable(literal, carrier.name)) return carrier;
  for (const name of ["int32", "int64", "int128"] as const) {
    if (rustNumericPromotionKind(carrier.name, name) === name && selectedSourceLiteralIsRepresentable(literal, name)) {
      return { kind: "source-primitive", name };
    }
  }
  return undefined;
}

export function selectedIntegerLiteralUnionJoin(
  literal: SourceLiteralValue | undefined,
  carrier: TargetTypeRef,
  definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  if (literal?.integer === undefined) return undefined;
  const leaves = rustUnionLeaves(rustSourceOptionalElementCarrier(carrier) ?? carrier, definitions);
  if (leaves === undefined) return undefined;
  let selected: TargetTypeRef | undefined;
  for (const leaf of leaves) {
    if (leaf.carrier.kind === "source-primitive" &&
      (leaf.carrier.name === "float32" || leaf.carrier.name === "float64")) return undefined;
    const candidate = selectedIntegerLiteralJoin(literal, leaf.carrier);
    if (candidate === undefined) continue;
    if (selected !== undefined && !rustTargetTypeRefEquals(selected, candidate)) return undefined;
    selected = candidate;
  }
  return selected;
}

export function selectedSourceLiteralIsRepresentable(
  literal: SourceLiteralValue | undefined,
  primitive: SourcePrimitiveName,
): boolean {
  if (primitive === "bool") {
    return literal?.form === "true" || literal?.form === "false";
  }
  if (primitive === "float16" || primitive === "float32" || primitive === "float64") {
    const numeric = literal?.numeric;
    if (literal === undefined || numeric === undefined || literal.number === undefined) return false;
    if (primitive === "float64") return true;
    const overflowMidpoint = primitive === "float16" ? 65520n : rustFloat32OverflowMidpoint;
    return numeric.kind === "authored"
      ? compareSourceNumericLiteralMagnitude(numeric.token, overflowMidpoint) < 0
      : primitive === "float16"
        ? Math.abs(numeric.value) < 65520
        : Number.isFinite(Math.fround(numeric.value));
  }
  const value = literal?.integer;
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
  literalValues: SourceLiteralIndex,
): boolean {
  const parent = ast.parent(node);
  return parent !== undefined &&
    ast.kindName(parent) === "KindPrefixUnaryExpression" &&
    Node_Operand(ast, parent) === node &&
    selectedSourceLiteralIsRepresentable(literalValues.literalValue.get(parent), primitive);
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
