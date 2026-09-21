import type { TargetTypeRef } from "../model.js";
import { hasExactObjectKeys, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { isRustTargetTypeRef } from "../equality.js";
import { rustSourceTypeCarrierValue } from "./source-types.js";

export function rustClassConstructorTargetType(instance: TargetTypeRef): TargetTypeRef {
  if (!isRustTargetTypeRef(instance) || rustSourceTypeCarrierValue(instance)?.shape !== "object") {
    throw new Error("A native class constructor requires its exact project instance carrier.");
  }
  return Object.freeze({ kind: "target-specific", target: "rust", name: "class-constructor",
    value: Object.freeze({ instance: snapshotClosedMetadata(instance) }) });
}

export function rustClassConstructorInstance(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "class-constructor") return undefined;
  const value = carrier.value;
  if (typeof value !== "object" || value === null || !hasExactObjectKeys(value, ["instance"])) return undefined;
  const instance = (value as { readonly instance?: unknown }).instance;
  return isRustTargetTypeRef(instance) && rustSourceTypeCarrierValue(instance)?.shape === "object" ? instance : undefined;
}
