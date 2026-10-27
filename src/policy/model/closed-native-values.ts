import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustErrorDomain } from "../../target-model/operations/error-boundary.js";
import type { RustObjectRepresentation } from "../../target-model/records/objects/object-representation.js";

export interface RustClosedNativeProjectionPolicyInput {
  readonly target: TargetTypeRef;
  readonly representation: RustObjectRepresentation;
  readonly optional: boolean;
  readonly programError: boolean;
  readonly domain: RustErrorDomain;
}
