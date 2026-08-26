import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

export class RustMoveComplexityError extends Error {
  constructor(readonly diagnostic: TargetDiagnostic) {
    super(diagnostic.message);
  }
}
