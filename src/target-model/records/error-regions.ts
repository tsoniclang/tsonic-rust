import type { Node } from "@tsonic/tsts";
import type { RustProgramErrorOwner, TargetTypeRef } from "../types/model.js";
import type { RustNativeErrorSource } from "../types/native-error-joins.js";
import type { RustProducerErrorReference } from "../types/carriers/producer-errors.js";

export interface RustErrorRegionSelection {
  readonly localOwner: Extract<RustProgramErrorOwner, { readonly kind: "physical" }> | undefined;
  readonly sources: readonly RustNativeErrorSource<TargetTypeRef>[];
}

export interface RustErrorJoinDeclaration {
  readonly name: string;
  readonly arity: number;
  readonly clone: boolean;
}

export interface RustErrorRegionRecords {
  readonly get: (declaration: Node) => RustErrorRegionSelection | undefined;
  readonly declarationsFor: (fileName: string) => readonly RustErrorJoinDeclaration[];
  readonly producerError: (reference: RustProducerErrorReference) => TargetTypeRef | undefined;
}
