import { rustOptionTargetId } from "./source-types.js";
import type { TargetTypeRef } from "../model.js";
import {
  rustBuiltinPathTargetType,
  rustPathTypeArguments,
  rustPathTypeMatches,
} from "../constructors.js";

export function rustOptionTargetType(value: TargetTypeRef): TargetTypeRef {
  return rustBuiltinPathTargetType(rustOptionTargetId, "Option", [value]);
}

export function isRustOptionCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustPathTypeMatches(carrier, rustOptionTargetId) &&
    rustPathTypeArguments(carrier)?.length === 1;
}

export function rustOptionElementCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return isRustOptionCarrier(carrier)
    ? rustPathTypeArguments(carrier)?.[0]
    : undefined;
}
