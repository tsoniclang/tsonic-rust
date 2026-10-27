import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustIntegerRangeIndex } from "../../target-model/records/operations/integer-ranges.js";
import { rustUnsignedIntegerCounterpart } from "../../target-model/conversions/integer-refinement.js";
import type { RustIntegerRefinementConversion } from "../../target-model/conversions/integer-refinement.js";

export function selectRustGuardedIntegerConversion(
  input: { readonly integerRanges: RustIntegerRangeIndex },
  expression: Node, source: TargetTypeRef | undefined, target: TargetTypeRef | undefined,
): RustIntegerRefinementConversion | undefined {
  return source?.kind === "source-primitive" && target?.kind === "source-primitive" &&
    rustUnsignedIntegerCounterpart(source.name) === target.name && input.integerRanges.get(expression)
    ? { kind: "integer-refinement", source: source.name, target: target.name, proof: "nonnegative" } : undefined;
}
