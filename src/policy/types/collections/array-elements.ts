import type { SourceLiteralValue } from "@tsonic/target-api/source";
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

export function selectRustInferredNumericArrayElement(
  sourceElement: TargetTypeRef | undefined,
  contributions: readonly RustInferredNumericArrayContribution[],
  demands: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  if (contributions.length === 0) return undefined;
  const constraints = contributions.map(({ carrier, literal }) => ({ carrier,
    literal: literal?.numeric?.kind === "authored" || literal?.numeric === undefined && literal?.integer !== undefined
      ? literal : undefined }));
  const peers = constraints.filter(contribution => contribution.literal === undefined);
  if (peers.some(peer => !isRustNumericCarrier(peer.carrier))) return undefined;
  const destination = demands[0];
  if (destination !== undefined && isRustNumericCarrier(destination) &&
    demands.every(demand => rustTargetTypeRefEquals(demand, destination)) &&
    peers.every(peer => implicitNumericConversion(peer.carrier, destination))) return destination;
  const accepts = (candidate: TargetTypeRef): boolean => isRustNumericCarrier(candidate) &&
    constraints.every(contribution => contribution.literal === undefined
      ? implicitNumericConversion(contribution.carrier, candidate)
      : literalFits(contribution.literal, candidate));
  const homogeneous = peers[0]?.carrier;
  if (homogeneous !== undefined &&
    peers.every(peer => rustTargetTypeRefEquals(peer.carrier, homogeneous)) && accepts(homogeneous)) {
    return homogeneous;
  }
  if (!isRustNumericCarrier(sourceElement)) return undefined;
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
    applicable.every(other => implicitNumericConversion(candidate, other)));
  return least.length === 1 ? least[0] : undefined;
}

function literalFits(literal: SourceLiteralValue, target: TargetTypeRef): boolean {
  if (!isRustNumericCarrier(target)) return false;
  if (isRustIntegerCarrier(target) && literal.numeric?.kind === "authored" &&
    literal.numeric.token.negative && literal.numeric.token.coefficient === 0n) return false;
  return selectedSourceLiteralIsRepresentable(literal, target.name);
}

function implicitNumericConversion(source: TargetTypeRef, target: TargetTypeRef): boolean {
  if (rustTargetTypeRefEquals(source, target)) return true;
  if (!isRustNumericCarrier(source) || !isRustNumericCarrier(target)) return false;
  if (target.name === "float64" && isRustIntegerCarrier(source) &&
    !rustIntegerKindIsExactlyRepresentableAsFloat64(source.name)) return false;
  return rustNumericValueConversionIsSupported(source.name, target.name);
}
