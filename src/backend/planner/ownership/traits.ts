import type {
  RustTraitRef,
  RustTypeRef,
} from "../../../target-model/semantics/index.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function rustSealedCarrierSupportsTrait(
  carrier: RustTypeRef | undefined,
  trait: RustTraitRef,
  context: RustPlanContext,
): boolean {
  return carrier !== undefined &&
    context.input.program.ownership.traitProofFor(carrier, trait) !== undefined;
}

export function rustSealedOwnedCarrierReadKind(
  carrier: RustTypeRef | undefined,
  context: RustPlanContext,
): "copy" | "clone" | undefined {
  return carrier === undefined
    ? undefined
    : context.input.program.ownership.ownedReadForCarrier(carrier)?.kind;
}
