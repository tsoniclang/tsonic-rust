import type { RustTargetOperationFact } from "./keys.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
} from "./finalized-operation-abi.js";
import type { RustFinalizedOperationAbi } from "./finalized-operation-abi.js";
import { rustValueConversionIsFallible } from "./value-conversions.js";

export function rustTargetOperationText(fact: RustTargetOperationFact): string {
  if (fact.kind === "provider-operation") {
    const target = fact.abi.target;
    if (target.form === "call" || target.form === "path" || target.form === "free-call" ||
      target.form === "call-str-slice" || target.form === "free-call-str-slice" ||
      target.form === "call-value-slice" || target.form === "call-value-array") {
      return target.path;
    }
    if (target.form === "index") {
      return "[]";
    }
    if (target.form === "marker") {
      return "marker";
    }
    if (target.form === "binary-operator") {
      return target.operator;
    }
    return target.name;
  }
  if (fact.kind === "operator-token") {
    return fact.operator;
  }
  if (fact.kind === "string-concat") {
    return "+";
  }
  if (fact.kind === "conditional" || fact.kind === "identity-expression" ||
    fact.kind === "template-string" || fact.kind === "typeof" ||
    fact.kind === "void-expression") {
    return fact.operationId;
  }
  if (fact.kind === "switch") {
    return fact.operationId;
  }
  if (fact.kind === "source-conversion") {
    return fact.conversion === undefined ? "identity" : "runtime-conversion";
  }
  return fact.operationId;
}

export function rustTargetOperationIsDirectLocation(fact: RustTargetOperationFact | undefined): boolean {
  if (fact === undefined) {
    return false;
  }
  if (fact.kind === "tuple-index" || fact.kind === "fixed-index") {
    return true;
  }
  return fact.kind === "provider-operation" &&
    (fact.abi.target.form === "field" || fact.abi.target.form === "index");
}

export function rustTargetOperationSupportsAssignment(fact: RustTargetOperationFact | undefined): boolean {
  return fact?.kind === "source-field" || fact?.kind === "source-union-field" ||
    rustTargetOperationIsDirectLocation(fact);
}

export function rustTargetOperationIsFallible(fact: RustTargetOperationFact | undefined): boolean {
  if (fact === undefined) {
    return false;
  }
  if (fact.kind === "regexp-create") {
    return true;
  }
  if (fact.kind === "source-conversion") {
    return rustValueConversionIsFallible(fact.conversion);
  }
  if (fact.kind === "provider-operation" || fact.kind === "runtime-set") {
    return rustOperationAbiInvocationIsFallible(fact.abi);
  }
  return false;
}

export function rustOperationAbiInvocationIsFallible(abi: RustFinalizedOperationAbi): boolean {
  if (abi.effects.invocation === "fallible" ||
    (abi.targetReceiver.kind === "input" && abi.targetReceiver.input.conversion.fallible) ||
    abi.targetArguments.some((input) =>
      isRustFinalizedSourceInput(input)
        ? input.conversion.fallible
        : (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) &&
            input.elements.some((element) => element.conversion.fallible) ||
          isRustFinalizedTaggedArrayInput(input) &&
            input.elements.some((element) => element.input.conversion.fallible))) {
    return true;
  }
  return abi.result.kind === "sync" && abi.result.conversion.fallible;
}

export function rustOperationAbiAwaitIsFallible(abi: RustFinalizedOperationAbi): boolean {
  return abi.result.kind === "async" &&
    (abi.effects.awaiting === "fallible" || abi.result.awaitedConversion.fallible);
}

export function rustFinalizedCarrierTransitionMatches(
  source: TargetTypeRef,
  converted: TargetTypeRef | undefined,
  target: TargetTypeRef,
): boolean {
  if (rustTargetTypeRefEquals(source, target)) {
    return converted === undefined;
  }
  return converted !== undefined && rustTargetTypeRefEquals(converted, target);
}
