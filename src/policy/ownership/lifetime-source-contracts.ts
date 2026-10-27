import type { Node } from "@tsonic/tsts";

import { rustSourceTypeExportIds } from "../../target-model/identities/source.js";

import type { RustSourceLifetimeTypeContract } from "../../target-model/records/storage/source-lifetime-types.js";
export function rustLifetimeTypeContractFor(
  exportId: string,
  args: readonly Node[],
): RustSourceLifetimeTypeContract | undefined {
  switch (exportId) {
    case rustSourceTypeExportIds.life:
      return args.length === 0 ? { kind: "lifetime-kind" } : undefined;
    case rustSourceTypeExportIds.staticLifetime:
      return args.length === 0 ? { kind: "static-lifetime" } : undefined;
    case rustSourceTypeExportIds.placeholderLifetime:
      return args.length === 0 ? { kind: "placeholder-lifetime" } : undefined;
    case rustSourceTypeExportIds.sharedReference:
    case rustSourceTypeExportIds.mutableReference:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: exportId === rustSourceTypeExportIds.sharedReference
              ? "shared-reference"
              : "mutable-reference",
            targetTypeNode: args[0],
            ...(args[1] === undefined ? {} : { lifetimeTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.outlives:
    case rustSourceTypeExportIds.validFor:
      return args.length === 1 && args[0] !== undefined
        ? {
            kind: exportId === rustSourceTypeExportIds.outlives
              ? "outlives"
              : "valid-for",
            lifetimeTypeNode: args[0],
          }
        : undefined;
    case rustSourceTypeExportIds.dynamicTrait:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: "trait-object",
            traitTypeNode: args[0],
            ...(args[1] === undefined ? {} : { lifetimeTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.captureSet:
      return args.length === 1 && args[0] !== undefined
        ? { kind: "capture-set", tupleTypeNode: args[0] }
        : undefined;
    case rustSourceTypeExportIds.opaqueType:
      return args.length >= 1 && args.length <= 2 && args[0] !== undefined
        ? {
            kind: "opaque-type",
            boundTypeNode: args[0],
            ...(args[1] === undefined ? {} : { captureTypeNode: args[1] }),
          }
        : undefined;
    case rustSourceTypeExportIds.maybeSized:
      return args.length === 0 ? { kind: "maybe-sized" } : undefined;
    default:
      return undefined;
  }
}
