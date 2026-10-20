import { sourceNumericLiteralIsExactlyRepresentableAsBinaryFloat, type SourceLiteralValue } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustIntegerCarrier, isRustNumericCarrier } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustIntegerKindIsExactlyRepresentableAsFloat64, rustNumericValueConversionIsSupported } from "../../../target-model/conversions/numeric-promotion.js";
import { selectedSourceLiteralIsRepresentable } from "../../conversions/literals.js";

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
  const allNumeric = constraints.every(contribution => isRustNumericCarrier(contribution.carrier));
  const destination = demands[0];
  const consistentDestination = destination !== undefined &&
    demands.every(demand => rustTargetTypeRefEquals(demand, destination));
  if (destination !== undefined && isRustNumericCarrier(destination) &&
    consistentDestination &&
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
  if (consistentDestination && !isRustNumericCarrier(destination)) return unavailable;
  const unresolved: RustInferredNumericArrayElementSelection = constraints.some(({ carrier, literal }) =>
    flexibleInteger(literal) && literal?.numeric?.kind === "authored" && isRustNumericCarrier(carrier) &&
    (carrier.name === "float32" || carrier.name === "float64") &&
    !sourceNumericLiteralIsExactlyRepresentableAsBinaryFloat(literal.numeric.token, carrier.name))
    ? { kind: "rejected", reason: "An inferred numeric union requires an exact canonical carrier for every authored integer literal." }
    : unavailable;
  if (!allNumeric || !isRustNumericCarrier(sourceElement)) return unresolved;
  const integerCarriers = new Map<string, TargetTypeRef>();
  for (const { carrier } of peers) {
    if (isRustIntegerCarrier(carrier)) integerCarriers.set(carrier.name, carrier);
  }
  const fixedIntegers = [...integerCarriers.values()];
  const incompatibleIntegers = fixedIntegers.some(left => fixedIntegers.some(right =>
    !numericConversion(left, right, "inferred-storage") &&
    !numericConversion(right, left, "inferred-storage")));
  const actualFloating = constraints.some(({ carrier, literal }) => isRustNumericCarrier(carrier) &&
    (carrier.name === "float32" || carrier.name === "float64") && !flexibleInteger(literal));
  const candidates: TargetTypeRef[] = [];
  for (const contribution of constraints) {
    const { carrier } = contribution;
    if (!isRustNumericCarrier(carrier) || incompatibleIntegers && !actualFloating &&
      (carrier.name === "float32" || carrier.name === "float64")) {
      continue;
    }
    if (!candidates.some(candidate => rustTargetTypeRefEquals(candidate, carrier))) candidates.push(carrier);
  }
  const applicable = candidates.filter(accepts);
  const least = applicable.filter(candidate =>
    applicable.every(other => numericConversion(candidate, other, "inferred-storage")));
  if (least.length === 1) return { kind: "resolved", carrier: least[0]! };
  return unresolved.kind === "rejected" ? unresolved : peers.some(peer =>
    peer.carrier.kind === "source-primitive" && peer.carrier.name === "float32")
    ? { kind: "rejected", reason: "Array literal requires a lossless native element carrier for every fixed floating and numeric contribution." }
    : unresolved;
}

function flexibleInteger(literal: SourceLiteralValue | undefined): boolean {
  if (literal?.numeric?.kind !== "authored") return literal?.numeric === undefined && literal?.integer !== undefined;
  const { token } = literal.numeric;
  return !(token.negative && token.coefficient === 0n) &&
    (token.exponent >= 0n || token.coefficient === 0n || literal.integer !== undefined);
}

function literalFits(literal: SourceLiteralValue, target: TargetTypeRef): boolean {
  if (!isRustNumericCarrier(target)) return false;
  if (isRustIntegerCarrier(target) && literal.numeric?.kind === "authored" &&
    literal.numeric.token.negative && literal.numeric.token.coefficient === 0n) return false;
  if ((target.name === "float32" || target.name === "float64" && flexibleInteger(literal)) &&
    literal.numeric?.kind === "authored" &&
    !sourceNumericLiteralIsExactlyRepresentableAsBinaryFloat(literal.numeric.token, target.name)) return false;
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
