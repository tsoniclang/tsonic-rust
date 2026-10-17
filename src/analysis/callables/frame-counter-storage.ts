import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";
import type { RustFrameCallableDefinition, RustFrameCallablePlan } from "./frame-values.js";
import type { RustProjectConstructionQueries } from "../project-types/construction-plan.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";

export function rustRetainedFrameCounterName(
  definition: RustFrameCallableDefinition,
  input: { readonly callableValues: { readonly frames: Pick<RustFrameCallablePlan, "definitionForOwner"> };
    readonly projectTypes: RustProjectTypePolicy;
    readonly projectConstructions: RustProjectConstructionQueries },
): string | undefined {
  if (input.callableValues.frames.definitionForOwner(definition.activation.ownerDeclaration) !== definition)
    return failTargetPlannerInvariant("tsonic-rust", "A native frame counter requires its exact canonical frame definition.");
  if (definition.activation.kind === "lexical") return definition.counterName;
  const owner = input.projectTypes.definitionForDeclaration(definition.activation.ownerDeclaration);
  const construction = owner === undefined ? undefined : input.projectConstructions.forDefinition(owner);
  if (construction === undefined || construction.issues.length !== 0 || construction.emission.frame !== definition)
    return failTargetPlannerInvariant("tsonic-rust", "A native frame counter requires its exact completed construction owner.");
  const selected = construction.emission.counterDisposition;
  if (selected.kind === "absent" || selected.kind === "retained" && selected.name !== definition.counterName)
    return failTargetPlannerInvariant("tsonic-rust", "A native frame counter requires its exact sealed disposition.");
  return selected.kind === "retained" ? selected.name : undefined;
}
