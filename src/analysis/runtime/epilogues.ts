import type { RustProviderBinaryEpilogueRow } from "../../providers/packages/model.js";
import type { RustFallibleErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

interface RustBinaryEpiloguePlanBase {
  readonly id: string;
  readonly path: string;
}

export type RustBinaryEpiloguePlan =
  & RustBinaryEpiloguePlanBase
  & (
    | {
        readonly isFallible: true;
        readonly errorBoundary: "provider-native";
        readonly errorCarrier: TargetTypeRef;
      }
    | {
        readonly isFallible: true;
        readonly errorBoundary: Exclude<RustFallibleErrorBoundary, "provider-native">;
        readonly errorCarrier?: never;
      }
    | {
        readonly isFallible: false;
        readonly errorBoundary?: never;
        readonly errorCarrier?: never;
      }
  );

export function analyzeRustBinaryEpilogues(
  providerRows: readonly RustProviderBinaryEpilogueRow[],
  activeCrateNames: readonly string[],
): readonly RustBinaryEpiloguePlan[] {
  const activeCrates = new Set(activeCrateNames);
  return Object.freeze(providerRows.flatMap((row): RustBinaryEpiloguePlan[] => {
    if (!activeCrates.has(row.requiredCrate)) {
      return [];
    }
    if (row.isFallible !== true) {
      return [Object.freeze({
        id: row.id,
        path: row.path,
        isFallible: false,
      })];
    }
    if (row.errorBoundary === "provider-native") {
      return [Object.freeze({
        id: row.id,
        path: row.path,
        isFallible: true,
        errorBoundary: row.errorBoundary,
        errorCarrier: row.errorCarrier,
      })];
    }
    return [Object.freeze({
      id: row.id,
      path: row.path,
      isFallible: true,
      errorBoundary: row.errorBoundary,
    })];
  }));
}
