import type { RustTargetOperationFact } from "./keys.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";

export function rustTargetOperationText(fact: RustTargetOperationFact): string {
  if (fact.kind === "provider-operation") {
    const target = fact.abi.target;
    if (target.form === "call" || target.form === "path" || target.form === "free-call" ||
      target.form === "call-str-slice" || target.form === "call-value-slice") {
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
  if (fact.kind === "conditional" || fact.kind === "identity-expression") {
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
  if (fact.kind === "source-field" || fact.kind === "tuple-index" || fact.kind === "fixed-index") {
    return true;
  }
  return fact.kind === "provider-operation" &&
    (fact.abi.target.form === "field" || fact.abi.target.form === "index");
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
