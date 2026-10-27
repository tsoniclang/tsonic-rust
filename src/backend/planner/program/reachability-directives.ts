import type { Node } from "@tsonic/tsts";
import type { RustPlanningContext } from "../context.js";
import type { RustDeadCodeDisposition, RustStructuralLivenessEmission } from "../../../target-model/records/native/native-liveness.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

interface RustLivenessPlanningContext {
  readonly input: RustPlanningContext;
}

export function rustAuthoredDeadCodeDisposition(context: RustLivenessPlanningContext,
  declaration: Node): RustDeadCodeDisposition | undefined {
  const selected = context.input.program.records.authoredLiveness.get(declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted native declaration requires its sealed authored liveness.", declaration);
  return selected.deadCode;
}

function structuralLiveness(context: RustLivenessPlanningContext, carriers: readonly TargetTypeRef[],
  publiclyReachable: boolean): RustStructuralLivenessEmission {
  const selected = context.input.program.records.structuralLiveness.get(carriers, publiclyReachable);
  if (selected === undefined) failRustPlannerInvariant("An admitted structural carrier group requires its sealed native liveness.");
  return selected;
}

export function rustGeneratedUnionVariantDeadCodeDisposition(context: RustLivenessPlanningContext,
  carriers: readonly TargetTypeRef[], variantName: string, publiclyReachable: boolean): RustDeadCodeDisposition | undefined {
  const selected = structuralLiveness(context, carriers, publiclyReachable);
  if (!selected.variants.has(variantName)) failRustPlannerInvariant("An admitted union variant requires its sealed source liveness.");
  return selected.variants.get(variantName);
}

export function rustStructuralShapeDeadCodeDisposition(context: RustLivenessPlanningContext,
  carriers: readonly TargetTypeRef[], publiclyReachable: boolean): RustDeadCodeDisposition | undefined {
  return structuralLiveness(context, carriers, publiclyReachable).deadCode;
}

export function rustStructuralFieldDeadCodeDisposition(context: RustLivenessPlanningContext,
  carriers: readonly TargetTypeRef[], storageIndex: number, publiclyReachable: boolean,
  role: "value" | "getter" | "setter"): RustDeadCodeDisposition | undefined {
  const selected = structuralLiveness(context, carriers, publiclyReachable).fields.get(storageIndex);
  if (selected === undefined) failRustPlannerInvariant("An admitted structural storage field requires its sealed native liveness.");
  return selected[role];
}
