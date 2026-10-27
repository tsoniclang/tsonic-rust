import type { RustProviderBinaryHookRow } from "../../target-model/metadata/provider-metadata.js";
import type { RustBinaryHookPlan } from "../../target-model/records/operations/binary-execution.js";
import type { RustDispatchContextGroupInput } from "../../target-model/operations/dispatch-contexts.js";

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
        dispatchGroups: row.dispatchGroups ?? emptyDispatchGroups,
        isFallible: false,
      })];
    }
    if (row.errorBoundary === "provider-native") {
      return [Object.freeze({
        id: row.id,
        phase: row.phase,
        path: row.path,
        dispatchGroups: row.dispatchGroups ?? emptyDispatchGroups,
        isFallible: true,
        errorBoundary: row.errorBoundary,
        errorCarrier: row.errorCarrier,
      })];
    }
    return [Object.freeze({
      id: row.id,
      phase: row.phase,
      path: row.path,
      dispatchGroups: row.dispatchGroups ?? emptyDispatchGroups,
      isFallible: true,
      errorBoundary: row.errorBoundary,
    })];
  }));
}

const emptyDispatchGroups: readonly RustDispatchContextGroupInput[] = Object.freeze([]);
