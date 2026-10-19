import type { Node } from "@tsonic/tsts";
import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";

export function failRustPlannerInvariant(message: string, sourceNode?: Node): never {
  return failTargetPlannerInvariant("tsonic-rust", message, sourceNode);
}
