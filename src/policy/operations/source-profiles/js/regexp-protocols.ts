import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";

import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";

import type { RustArgumentMode, RustValueConversion } from "../../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../../target-model/types/index.js";

export type RegExpProtocolSymbol = "match" | "match-all" | "replace" | "search" | "split";

interface RegExpProtocolSelection {
  readonly operation: "match" | "matchAll" | "replace" | "replaceAll" | "search" | "split";
  readonly symbol: RegExpProtocolSymbol;
}

export interface ProtocolArgumentPlan {
  readonly sourceCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly conversion?: RustValueConversion;
}

export function selectedRegExpProtocol(
  ownerName: string,
  memberName: string,
): RegExpProtocolSelection | undefined {
  if (ownerName !== jsRegExpSourceProfileIdentity.owners.string) {
    return undefined;
  }
  switch (memberName) {
    case "match": return { operation: "match", symbol: "match" };
    case "matchAll": return { operation: "matchAll", symbol: "match-all" };
    case "replace": return { operation: "replace", symbol: "replace" };
    case "replaceAll": return { operation: "replaceAll", symbol: "replace" };
    case "search": return { operation: "search", symbol: "search" };
    case "split": return { operation: "split", symbol: "split" };
    default: return undefined;
  }
}

export function selectProtocolArgument(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): ProtocolArgumentPlan | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return { sourceCarrier, mode: "value" };
  }
  if (targetCarrier.kind === "reference" &&
    rustTargetTypeRefEquals(sourceCarrier, targetCarrier.referent)) {
    return {
      sourceCarrier,
      mode: targetCarrier.mutable ? "mut-ref" : "ref",
    };
  }
  const optionalElement = rustOptionElementCarrier(targetCarrier);
  return optionalElement !== undefined && rustTargetTypeRefEquals(sourceCarrier, optionalElement)
    ? {
        sourceCarrier,
        mode: "value",
        conversion: { kind: "option-some", source: sourceCarrier, element: sourceCarrier, elementConversion: null },
      }
    : undefined;
}
