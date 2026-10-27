import type { Node } from "@tsonic/tsts";
import type { RustIntegerRangeIndex } from "../../../target-model/records/operations/integer-ranges.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { selectRustGuardedIntegerConversion } from "../../conversions/integer-refinement.js";
import { selectRustBinaryOperator } from "../operators/rules.js";

export function selectRustGuardedIntegerOperation(input: { readonly integerRanges: RustIntegerRangeIndex }, operator: string,
  leftNode: Node, rightNode: Node, left: TargetTypeRef | undefined, right: TargetTypeRef | undefined,
): ReturnType<typeof selectRustBinaryOperator> {
  const leftConversion = selectRustGuardedIntegerConversion(input, leftNode, left, right);
  const conversion = leftConversion ?? selectRustGuardedIntegerConversion(input, rightNode, right, left);
  if (conversion === undefined) return undefined;
  const unsigned = rustSourcePrimitiveTargetType(conversion.target);
  const selected = selectRustBinaryOperator(operator, unsigned, unsigned);
  if (selected?.kind !== "operator-token" && selected?.kind !== "operator-call") return undefined;
  return { ...selected, [leftConversion === undefined ? "rightConversion" : "leftConversion"]: conversion };
}
