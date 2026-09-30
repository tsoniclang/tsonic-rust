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
  const semantics = walk.context.semanticsFor(expression);
  if (walk.context.ast.is.IsArrayLiteralExpression(expression)) {
    const candidates = union.variants.filter(variant => variant.sourceTypes.length > 0 &&
      variant.sourceTypes.every(type => semantics.types.isArrayLike(type)));
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  const selection = semantics.types.contextualValueSelection(expression);
  const contextualTypes = selection.kind === "selected" ? [selection.type]
    : selection.kind === "ambiguous" ? selection.types : [];
  const callableTypes = contextualTypes.filter(type => semantics.types.callable(type) !== undefined);
  const selectedSourceType = callableTypes.length === 1 ? callableTypes[0]
    : semantics.types.expressionType(expression);
  const selectedCarrier = resolveRustTargetTypeRef(
    selectedSourceType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const candidates = union.variants.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, selectedCarrier));
  return candidates.length === 1 ? candidates[0] : undefined;
}
