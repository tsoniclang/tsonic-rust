import type { AstReader, Node } from "@tsonic/tsts";
import { sourceIntegerLiteralValue } from "@tsonic/target-api";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustIntegerTruncationConversionMatches,
  type RustIntegerTruncationConversion,
} from "../../target-model/conversions/integer-truncation.js";

const truncations = new Map([
  ["tsonic.rust.js.BigIntConstructor.asIntN.call.bigint", true],
  ["tsonic.rust.js.BigIntConstructor.asIntN.call.integer", true],
  ["tsonic.rust.js.BigIntConstructor.asUintN.call.bigint", false],
  ["tsonic.rust.js.BigIntConstructor.asUintN.call.integer", false],
]);

export function selectRustIntegerTruncationConversion(
  ast: AstReader,
  node: Node,
  operationId: string | undefined,
  source: TargetTypeRef,
  target: TargetTypeRef,
): RustIntegerTruncationConversion | undefined {
  if (operationId === undefined) return undefined;
  const signed = truncations.get(operationId);
  const args = ast.as.AsCallExpression(node)?.Arguments?.Nodes;
  const widthNode = args?.[0];
  if (signed === undefined || args?.length !== 2 || widthNode === undefined) return undefined;
  const width = sourceIntegerLiteralValue(ast, widthNode);
  if (width === undefined || width < 0n || width > 128n) return undefined;
  const conversion: RustIntegerTruncationConversion = {
    kind: "integer-truncation", signed, width: Number(width),
  };
  return rustIntegerTruncationConversionMatches(source, target, conversion) ? conversion : undefined;
}
