import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceUnion, RustSourceUnionVariant } from "../project-types/source-type-registry.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function selectRustUnionVariantByCheckedType(
  walk: RustFactWalk,
  expression: Node,
  union: RustSourceUnion,
): RustSourceUnionVariant | undefined {
  const selectedSourceType = walk.context.semanticsFor(expression).types.expressionType(expression);
  const selectedCarrier = resolveRustTargetTypeRef(
    selectedSourceType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const candidates = union.variants.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, selectedCarrier));
  return candidates.length === 1 ? candidates[0] : undefined;
}
