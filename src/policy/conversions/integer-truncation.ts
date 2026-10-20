import { type AstReader, type Node } from "@tsonic/tsts";
import { sourceIntegerLiteralValue, sourceIntegerTruncationFits } from "@tsonic/target-api/source";
import { type TargetTypeRef } from "../../target-model/types/model.js";
import { type RustIntegerTruncationConversion } from "../../target-model/conversions/integer-truncation.js";
import { rustIntegerTruncationConversionMatches } from "./integer-truncation.js";
import { isRustBigIntCarrier } from "../../target-model/types/index.js";

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






export function rustIntegerTruncationConversionMatches(
  source: TargetTypeRef,
  target: TargetTypeRef,
  conversion: RustIntegerTruncationConversion,
): boolean {
  return isRustBigIntCarrier(source) && target.kind === "source-primitive" &&
    sourceIntegerTruncationFits(conversion.width, conversion.signed, target.name);
}
