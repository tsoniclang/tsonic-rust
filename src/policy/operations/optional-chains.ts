import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustOptionalChainFact } from "./model.js";
import {
  rustOptionElementCarrier,
  rustOptionTargetType,
} from "../types/target-types.js";

export type RustOptionalChainSelection =
  | { readonly kind: "direct"; readonly resultCarrier: TargetTypeRef }
  | { readonly kind: "optional"; readonly fact: RustOptionalChainFact }
  | { readonly kind: "rejected"; readonly message: string };

export interface RustOptionalChainSelectionInput {
  readonly expression: Node;
  readonly guard: Node;
  readonly operationKind: RustOptionalChainFact["operationKind"];
  readonly sourceGuardCarrier: TargetTypeRef | undefined;
  readonly selectedGuardCarrier: TargetTypeRef | undefined;
  readonly innerResultCarrier: TargetTypeRef | undefined;
  readonly sourceResultCarrier?: TargetTypeRef;
}

export function selectRustOptionalChain(
  input: RustOptionalChainSelectionInput,
): RustOptionalChainSelection {
  const {
    sourceGuardCarrier,
    selectedGuardCarrier,
    innerResultCarrier,
    sourceResultCarrier,
  } = input;
  if (sourceGuardCarrier === undefined || selectedGuardCarrier === undefined ||
    innerResultCarrier === undefined) {
    return {
      kind: "rejected",
      message: "Optional chaining requires exact source, selected-receiver, and inner-result carriers.",
    };
  }
  if (rustTargetTypeRefEquals(sourceGuardCarrier, selectedGuardCarrier)) {
    return sourceResultCarrier === undefined ||
      rustTargetTypeRefEquals(sourceResultCarrier, innerResultCarrier)
      ? { kind: "direct", resultCarrier: innerResultCarrier }
      : {
          kind: "rejected",
          message: "Checker-proven non-null optional syntax has a final carrier that conflicts with the selected operation result.",
        };
  }
  const sourceElement = rustOptionElementCarrier(sourceGuardCarrier);
  if (sourceElement === undefined || !rustTargetTypeRefEquals(sourceElement, selectedGuardCarrier)) {
    return {
      kind: "rejected",
      message: "Optional-chain guard must be exactly Option of the TSTS-selected non-null receiver carrier.",
    };
  }
  const innerIsOption = rustOptionElementCarrier(innerResultCarrier) !== undefined;
  const resultCarrier = innerIsOption
    ? innerResultCarrier
    : rustOptionTargetType(innerResultCarrier);
  const lowering = innerIsOption ? "and-then" : "map";
  if (sourceResultCarrier !== undefined &&
    !rustTargetTypeRefEquals(sourceResultCarrier, resultCarrier)) {
    return {
      kind: "rejected",
      message: "Optional-chain final result must be the exact mapped or flattened Option of the selected operation result.",
    };
  }
  return {
    kind: "optional",
    fact: {
      expression: input.expression,
      guard: input.guard,
      operationKind: input.operationKind,
      sourceGuardCarrier,
      selectedGuardCarrier,
      innerResultCarrier,
      resultCarrier,
      lowering,
    },
  };
}
