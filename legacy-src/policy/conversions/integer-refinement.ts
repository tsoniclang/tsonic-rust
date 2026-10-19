import { sourceIntegerIsNonnegative } from "@tsonic/target-api/source";
import type { AstReader, Node, ReadonlySourceFactResolver } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustUnsignedIntegerCounterpart } from "../../target-model/conversions/integer-refinement.js";
import type { RustIntegerRefinementConversion } from "../../target-model/conversions/integer-refinement.js";

export function selectRustGuardedIntegerConversion(input: { readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation; readonly sourceFacts?: ReadonlySourceFactResolver },
  expression: Node, source: TargetTypeRef | undefined, target: TargetTypeRef | undefined,
): RustIntegerRefinementConversion | undefined {
  return source?.kind === "source-primitive" && target?.kind === "source-primitive" &&
    rustUnsignedIntegerCounterpart(source.name) === target.name &&
    sourceIntegerIsNonnegative(input, expression)
    ? { kind: "integer-refinement", source: source.name, target: target.name, proof: "nonnegative" } : undefined;
}
