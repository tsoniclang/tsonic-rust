import type { TargetTypeRef } from "../types/model.js";
import type { RustPhysicalCallableSourceSelection } from "./physical-emission-contexts.js";
import type { RustNativeCallableInput } from "./native-protocols.js";

export type RustNativeStorageSelection =
  | { readonly kind: "identity"; readonly carrier: TargetTypeRef;
      readonly sources: readonly RustPhysicalCallableSourceSelection[] }
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef; readonly inputs: readonly RustNativeCallableInput[];
      readonly sources: readonly RustPhysicalCallableSourceSelection[] }
  | { readonly kind: "unresolved"; readonly reason: string };
