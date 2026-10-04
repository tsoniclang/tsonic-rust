import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  isRustJsArrayCarrier,
  isRustVecCarrier,
  rustFixedArrayCarrierValue,
  rustTargetConstInteger,
} from "../../../target-model/types/index.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function resolveRustContextualLiteralCarrier(
  context: Pick<RustTargetTypeResolutionContext, "ast">,
  node: Node,
  expected: TargetTypeRef,
): TargetTypeRef | undefined {
  if (!context.ast.is.IsArrayLiteralExpression(node) || context.ast.elements(node).length !== 0) return undefined;
  const carrier = rustSourceOptionalElementCarrier(expected) ?? expected;
  if (isRustVecCarrier(carrier) || isRustJsArrayCarrier(carrier) ||
    carrier.kind === "tuple" && carrier.elements.length === 0) return carrier;
  const fixed = rustFixedArrayCarrierValue(carrier);
  return fixed !== undefined && rustTargetConstInteger(fixed.length) === 0n ? carrier : undefined;
}
