import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustLifetimeRef } from "../lifetimes/index.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustTargetGenericReferences } from "../types/carriers/generic-references.js";
import type { RustNativeCallableInput } from "./native-protocols.js";

export type RustNativeCaptureSelection =
  | { readonly kind: "resolved"; readonly captures: readonly TargetTypeRef[];
      readonly receiverFields: readonly TargetTypeRef[]; readonly receivers: readonly TargetTypeRef[];
      readonly taskScope: { readonly lifecycleOwner: SourceFile; readonly position: number; readonly storage: "owned" } |
        { readonly lifecycleOwner: SourceFile; readonly position: number; readonly storage: "borrow"; readonly lifetime: RustLifetimeRef } | undefined;
      readonly inputs: readonly RustNativeCallableInput[]; readonly environment: RustTargetGenericReferences }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeCapturePlan {
  forDeclaration(declaration: Node): RustNativeCaptureSelection;
}
