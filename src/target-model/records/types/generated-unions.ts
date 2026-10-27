import type { TargetTypeRef } from "../../types/model.js";
import type { RustSourceUnionPayloadTemplate } from "../../types/source-union-definitions.js";

export interface RustGeneratedUnionDefinition {
  readonly ownerFileName: string;
  readonly componentId: string;
  readonly targetName: string;
  readonly payloadTemplate: RustSourceUnionPayloadTemplate;
  readonly sourceCarriers: readonly TargetTypeRef[];
  readonly numberArrayLike: boolean;
}

export const rustNumberArrayLikeMembers = Object.freeze([
  Object.freeze({ name: "number_array_length", indexed: false, result: "length" as const }),
  Object.freeze({ name: "number_array_get", indexed: true, result: "optional-number" as const }),
  Object.freeze({ name: "number_array_copy", indexed: false, result: "number-array" as const }),
]);
