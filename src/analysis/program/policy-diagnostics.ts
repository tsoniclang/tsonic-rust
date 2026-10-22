import type { Node } from "@tsonic/tsts";

import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

import type { RustPolicyDiagnostic } from "../../policy/model/contracts.js";
export function rustPolicyTargetDiagnostic(
  diagnostic: RustPolicyDiagnostic,
): TargetDiagnostic {
  return {
    code: diagnostic.extensionCode,
    category: diagnostic.category,
    source: "tsonic-rust",
    message: diagnostic.message,
    ...(diagnostic.nodeOrSpan === undefined
      ? {}
      : { sourceNode: diagnostic.nodeOrSpan as Node }),
    ...(diagnostic.evidence === undefined
      ? {}
      : { evidence: diagnostic.evidence.map((entry) => entry.message) }),
  };
}
