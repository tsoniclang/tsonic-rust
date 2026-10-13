import type { Node } from "@tsonic/tsts";
import type { RustLifetimeRef } from "../lifetimes/index.js";

export interface RustRetainedEnvironment {
  readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
  readonly parameters: readonly Node[];
}
