import type { Node, Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustAbsenceCarrier, isRustNeverCarrier, isRustUnitCarrier, rustAbsenceTargetType } from "../../../target-model/types/index.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { resolveRustInferredUnion } from "./inferred-unions.js";
import { resolveRustSourceUnionCarrier, resolveRustUnionValueCarrier } from "./source-unions.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";

export function resolveRustBranchUnion(
  expression: Node,
  branches: readonly { readonly expression: Node; readonly carrier: TargetTypeRef }[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const semantics = context.currentSemantics;
  const sourceType = semantics.types.expressionType(expression);
  if (sourceType === undefined || branches.length > 128) return undefined;
  const members: Type[] = [];
  const carriers: TargetTypeRef[] = [];
  let absent = false;
  for (const branch of branches) {
    if (isRustNeverCarrier(branch.carrier)) continue;
    if (isRustAbsenceCarrier(branch.carrier) || isRustUnitCarrier(branch.carrier)) {
      absent = true;
      continue;
    }
    const optional = rustSourceOptionalElementCarrier(branch.carrier);
    absent ||= optional !== undefined;
    const carrier = optional ?? branch.carrier;
    const type = semantics.types.expressionType(branch.expression);
    if (type === undefined) return undefined;
    const types = (semantics.types.isUnion(type) ? semantics.types.unionOrIntersectionTypes(type) : [type])
      .filter(member => !semantics.types.isNullish(member) && !semantics.types.isVoidLike(member));
    if (types.length === 0 || types.length > 4096) return undefined;
    const union = options.sourceTypes.sourceUnionForCarrier(carrier);
    if (union === undefined) {
      if (options.sourceTypes.sourceUnionVariants(carrier) !== undefined) return undefined;
      members.push(...types);
      carriers.push(...types.map(() => carrier));
    } else {
      for (const member of types) {
        const selected = union.variants.filter(variant => variant.sourceTypes.some(source =>
          semantics.types.isIdentical(source, member)));
        if (selected.length !== 1) return undefined;
        members.push(member);
        carriers.push(selected[0]!.carrier);
      }
    }
    if (members.length > 4096) return undefined;
  }
  return resolveRustSourceUnionCarrier([
    ...carriers,
    ...(absent ? [rustAbsenceTargetType()] : []),
  ], values => resolveRustUnionValueCarrier(values, options, () =>
    resolveRustInferredUnion(sourceType, members, carriers, context, options)));
}
