import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustBindingStorageFact } from "../operations/operation-selections.js";

export type RustLocalBindingCompletion =
  | { readonly kind: "erased" }
  | { readonly kind: "pattern"; readonly pattern: Node; readonly initializer: Node; readonly carrier: TargetTypeRef }
  | { readonly kind: "function"; readonly initializer: Node; readonly name: string }
  | { readonly kind: "value"; readonly name: string; readonly initializer: Node | undefined;
      readonly carrier: TargetTypeRef; readonly nativeCarrier: TargetTypeRef; readonly initializerCarrier: TargetTypeRef | undefined;
      readonly storage: RustBindingStorageFact | undefined; readonly mutable: boolean; readonly selfTypedInitializer: boolean;
      readonly annotated: boolean; readonly absenceInitializer: boolean };
