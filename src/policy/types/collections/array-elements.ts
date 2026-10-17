import { sourceNumericLiteralIsExactlyRepresentableAsBinaryFloat, type SourceLiteralValue } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustIntegerCarrier, isRustNumericCarrier } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  rustIntegerKindIsExactlyRepresentableAsFloat64,
  rustNumericValueConversionIsSupported,
} from "../../../target-model/conversions/numeric-promotion.js";
import { selectedSourceLiteralIsRepresentable } from "../resolution/selected-numeric-literal.js";

export interface RustInferredNumericArrayContribution {
  readonly carrier: TargetTypeRef;
  readonly literal: SourceLiteralValue | undefined;
}

export type RustInferredNumericArrayElementSelection =
  | { readonly kind: "resolved"; readonly carrier: TargetTypeRef }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "unavailable" };

export function selectRustInferredNumericArrayElement(
  sourceElement: TargetTypeRef | undefined,
  contributions: readonly RustInferredNumericArrayContribution[],
  demands: readonly TargetTypeRef[],
): RustInferredNumericArrayElementSelection {
  const unavailable = { kind: "unavailable" } as const;
  if (contributions.length === 0) return unavailable;
  const constraints = contributions.map(({ carrier, literal }) => ({ carrier,
    literal: literal?.numeric?.kind === "authored" || literal?.numeric === undefined && literal?.integer !== undefined
      ? literal : undefined }));
  const peers = constraints.filter(contribution => contribution.literal === undefined);
  if (constraints.some(contribution => !isRustNumericCarrier(contribution.carrier))) return unavailable;
  const destination = demands[0];
  if (destination !== undefined && isRustNumericCarrier(destination) &&
    demands.every(demand => rustTargetTypeRefEquals(demand, destination)) &&
    peers.every(peer => numericConversion(peer.carrier, destination, "explicit-storage"))) {
    return { kind: "resolved", carrier: destination };
  }
  const accepts = (candidate: TargetTypeRef): boolean => isRustNumericCarrier(candidate) &&
    constraints.every(contribution => contribution.literal === undefined
      ? numericConversion(contribution.carrier, candidate, "inferred-storage")
      : literalFits(contribution.literal, candidate));
  const homogeneous = peers[0]?.carrier;
  if (homogeneous !== undefined &&
    peers.every(peer => rustTargetTypeRefEquals(peer.carrier, homogeneous)) && accepts(homogeneous)) {
    return { kind: "resolved", carrier: homogeneous };
  }
  const unresolved: RustInferredNumericArrayElementSelection = peers.some(peer =>
    peer.carrier.kind === "source-primitive" && peer.carrier.name === "float32")
    ? { kind: "rejected", reason: "Array literal requires a lossless native element carrier for every fixed floating and numeric contribution." }
    : unavailable;
  if (!isRustNumericCarrier(sourceElement)) return unresolved;
  const candidates: TargetTypeRef[] = [];
  for (const contribution of constraints) {
    const { carrier, literal } = contribution;
    if (!isRustNumericCarrier(carrier) || literal?.integer !== undefined &&
      peers.some(peer => isRustIntegerCarrier(peer.carrier) && literalFits(literal, peer.carrier))) {
      continue;
    }
    if (!candidates.some(candidate => rustTargetTypeRefEquals(candidate, carrier))) candidates.push(carrier);
  }
  const applicable = candidates.filter(accepts);
  const least = applicable.filter(candidate =>
    applicable.every(other => numericConversion(candidate, other, "inferred-storage")));
  if (least.length === 1) return { kind: "resolved", carrier: least[0]! };
  return unresolved;
}

function literalFits(literal: SourceLiteralValue, target: TargetTypeRef): boolean {
  if (!isRustNumericCarrier(target)) return false;
  if (isRustIntegerCarrier(target) && literal.numeric?.kind === "authored" &&
    literal.numeric.token.negative && literal.numeric.token.coefficient === 0n) return false;
  if (target.name === "float32" && literal.numeric?.kind === "authored" &&
    !sourceNumericLiteralIsExactlyRepresentableAsBinaryFloat(literal.numeric.token, "float32")) return false;
  return selectedSourceLiteralIsRepresentable(literal, target.name);
}

function numericConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  mode: "explicit-storage" | "inferred-storage",
): boolean {
  if (rustTargetTypeRefEquals(source, target)) return true;
  if (!isRustNumericCarrier(source) || !isRustNumericCarrier(target)) return false;
  if (target.name === "float64" && isRustIntegerCarrier(source) &&
    !rustIntegerKindIsExactlyRepresentableAsFloat64(source.name)) return false;
  if (mode === "inferred-storage" && target.name === "float32" && isRustIntegerCarrier(source) &&
    !["int8", "uint8", "int16", "uint16"].includes(source.name)) return false;
  return rustNumericValueConversionIsSupported(source.name, target.name);
}
