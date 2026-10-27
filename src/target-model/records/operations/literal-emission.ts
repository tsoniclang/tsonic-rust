import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export type RustLiteralEmission =
  | { readonly kind: "integer"; readonly text: string }
  | { readonly kind: "float"; readonly text: string; readonly negative: boolean; readonly cast: "f32" | undefined }
  | { readonly kind: "bigint"; readonly bytes: readonly number[] };

export interface RustLiteralEmissionRecords {
  readonly literalEmission: { readonly get: (node: Node, carrier: TargetTypeRef) => RustLiteralEmission | undefined };
}
