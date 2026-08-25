import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

export function rustOwnershipDiagnostic(
  code: string,
  message: string,
  sourceNode?: Node,
  evidence: readonly string[] = Object.freeze([]),
): TargetDiagnostic {
  return Object.freeze({
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    ...(sourceNode === undefined ? {} : { sourceNode }),
    evidence: Object.freeze([
      "target.capability=rust.ownership.sealed-analysis",
      ...evidence,
    ]),
  });
}
