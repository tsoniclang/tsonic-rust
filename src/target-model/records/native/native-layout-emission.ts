import type { RustNativeMemoryLayout } from "../../operations/native-memory.js";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustNativeLayoutEmission {
  readonly owner: TargetTypeRef;
  readonly fields: readonly string[];
  readonly hasWrites: boolean;
}

export interface RustNativeLayoutRecords {
  readonly nativeLayoutEmission: { readonly get: (layout: RustNativeMemoryLayout) => RustNativeLayoutEmission | undefined };
}
