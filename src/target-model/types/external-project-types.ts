import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "./model.js";

export interface RustExternalProjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly initializer:
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "message"; readonly parameterIndex: number }
    | { readonly kind: "none" };
}

export interface RustExternalProjectBase {
  readonly id: "rust.source-profile.Error";
  readonly declaration: Node;
  readonly targetType: TargetTypeRef;
  readonly constructorOperationId: "tsonic.rust.error.constructor";
  readonly constructorPath: "rt::JsError::error";
  readonly constructorDeclarations: readonly Node[];
  readonly fields: readonly RustExternalProjectField[];
  readonly programError: true;
}
