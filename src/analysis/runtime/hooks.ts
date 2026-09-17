import type { RustProviderBinaryHookRow } from "../../providers/packages/model.js";
import type { RustFallibleErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

interface RustBinaryHookPlanBase {
  readonly id: string;
  readonly phase: "before-initialization" | "after-entry";
  readonly path: string;
}

export type RustBinaryHookPlan =
  & RustBinaryHookPlanBase
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

export function analyzeRustBinaryHooks(
  providerRows: readonly RustProviderBinaryHookRow[],
  activeCrateNames: readonly string[],
): readonly RustBinaryHookPlan[] {
  const activeCrates = new Set(activeCrateNames);
  return Object.freeze(providerRows.flatMap((row): RustBinaryHookPlan[] => {
    if (!activeCrates.has(row.requiredCrate)) {
      return [];
    }
    if (row.isFallible !== true) {
      return [Object.freeze({
        id: row.id,
        phase: row.phase,
        path: row.path,
        isFallible: false,
      })];
    }
    if (row.errorBoundary === "provider-native") {
      return [Object.freeze({
        id: row.id,
        phase: row.phase,
        path: row.path,
        isFallible: true,
        errorBoundary: row.errorBoundary,
        errorCarrier: row.errorCarrier,
      })];
    }
    return [Object.freeze({
      id: row.id,
      phase: row.phase,
      path: row.path,
      isFallible: true,
      errorBoundary: row.errorBoundary,
    })];
  }));
}
