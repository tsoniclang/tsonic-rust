import type { RustTargetGenericArgument, TargetTypeRef } from "../model.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { isRustTargetTypeRef } from "../equality.js";
import { rustSourceTypeCarrierValue } from "./source-types.js";

export interface RustClassConstructorContract {
  readonly instance: TargetTypeRef;
  readonly boundParameterIndexes: readonly number[];
}

export function rustClassConstructorTargetType(instance: TargetTypeRef, boundParameterIndexes: readonly number[] = []): TargetTypeRef {
  if (!isRustTargetTypeRef(instance) || rustSourceTypeCarrierValue(instance)?.shape !== "object") {
    throw new Error("A native class constructor requires its exact project instance carrier.");
  }
  const value = { instance, boundParameterIndexes };
  if (!validContract(value)) throw new Error("A native class constructor requires exact bound parameter indexes.");
  return Object.freeze({ kind: "target-specific", target: "rust", name: "class-constructor",
    value: snapshotClosedMetadata(value) });
}

export function rustClassConstructorInstance(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return rustClassConstructorContract(carrier)?.instance;
}

export function rustClassConstructorContract(carrier: TargetTypeRef | undefined): RustClassConstructorContract | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "class-constructor") return undefined;
  const value = carrier.value;
  return validContract(value) ? value : undefined;
}

export function rustClassConstructorFreeArguments(carrier: TargetTypeRef): readonly RustTargetGenericArgument[] | undefined {
  const contract = rustClassConstructorContract(carrier);
  if (contract === undefined) return undefined;
  const bound = new Set(contract.boundParameterIndexes);
  return rustSourceTypeCarrierValue(contract.instance)!.genericArguments.filter((_, index) => !bound.has(index));
}

function validContract(value: unknown): value is RustClassConstructorContract {
  if (typeof value !== "object" || value === null || !hasExactObjectKeys(value, ["instance", "boundParameterIndexes"])) return false;
  const { instance, boundParameterIndexes: indexes } = value as { readonly instance?: unknown; readonly boundParameterIndexes?: unknown };
  if (!isRustTargetTypeRef(instance) || !isDenseDataArray(indexes)) return false;
  const selected = rustSourceTypeCarrierValue(instance);
  if (selected?.shape !== "object" || new Set(indexes).size !== indexes.length) return false;
  return indexes.every(index => {
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= selected.genericArguments.length) return false;
    const argument = selected.genericArguments[index]!;
    return argument.kind === "type" ? argument.type.kind === "type-parameter"
      : argument.kind === "lifetime" && argument.lifetime.kind === "parameter";
  });
}
