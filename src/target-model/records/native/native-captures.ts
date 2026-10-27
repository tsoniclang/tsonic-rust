import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetGenericReferences } from "../../types/carriers/generic-references.js";
import type { RustNativeCallableInput } from "./native-protocols.js";

export type RustNativeCaptureSelection =
  | { readonly kind: "resolved"; readonly captures: readonly TargetTypeRef[];
      readonly receiverFields: readonly TargetTypeRef[]; readonly receivers: readonly TargetTypeRef[];
      readonly inputs: readonly RustNativeCallableInput[]; readonly environment: RustTargetGenericReferences }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeCapturePlan {
  forDeclaration(declaration: Node): RustNativeCaptureSelection;
}
