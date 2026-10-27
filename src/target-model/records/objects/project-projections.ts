import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectDowncastRoute, RustProjectTypeDefinition } from "../../types/project-types.js";

export interface RustProjectProjectionImplementation {
  readonly route: RustProjectDowncastRoute;
  readonly sourceCarrier: TargetTypeRef;
  readonly genericOwner?: RustProjectTypeDefinition;
}
