import type { Node } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustNativeFutureInput {
  readonly owner: Node;
  readonly subject: SourceStorageSubject;
  readonly carrier: TargetTypeRef;
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
}

export type RustNativeFutureEnvironmentSelection =
  | { readonly kind: "resolved"; readonly inputs: readonly RustNativeFutureInput[];
      readonly captures: readonly RustNativeFutureInput[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeFutureInputPlan {
  forDeclaration(declaration: Node): RustNativeFutureEnvironmentSelection;
  forSubject(subject: SourceStorageSubject): readonly RustNativeFutureInput[];
}
