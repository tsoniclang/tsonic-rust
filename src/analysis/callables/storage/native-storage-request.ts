import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export type RustNativeStorageRequest = {
  readonly subject: SourceStorageSubject;
  readonly bindings: SourceStorageBindings | undefined;
  readonly scope: Node | undefined;
} & (
  | { readonly kind: "value"; readonly carrier: TargetTypeRef; readonly position: "value" | "input" }
  | { readonly kind: "invocation"; readonly declaration: Node }
);
