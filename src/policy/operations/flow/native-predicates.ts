import { type SourceNativeValueGuard } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustClosedTypePredicate } from "../../../target-model/operations/type-tests.js";

import { getRustTypeofRuntimeKind } from "../syntax/runtime-kind.js";
import { selectRustClosedTypeTestPlan } from "../operators/type-tests.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import { isRustAbsenceCarrier } from "../../../target-model/types/carriers/native.js";

export type RustNativeFlowPredicate = RustClosedTypePredicate | { readonly kind: "typeof"; readonly value: string; readonly negated: boolean }
  | Extract<SourceNativeValueGuard, { readonly kind: "literal" }>
  | { readonly kind: "absence"; readonly negated: boolean };

export function selectRustNativeCarrierPredicate(
  carrier: TargetTypeRef,
  predicate: RustNativeFlowPredicate,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): boolean | undefined {
  if (predicate.kind === "absence") {
    if (isRustAbsenceCarrier(carrier)) return !predicate.negated;
    return typeof getRustTypeofRuntimeKind(carrier, definitions) === "string" ? predicate.negated : undefined;
  }
  if (predicate.kind === "typeof") {
    const category = getRustTypeofRuntimeKind(carrier, definitions);
    return typeof category === "string" ? (category === predicate.value) !== predicate.negated : undefined;
  }
  if (predicate.kind === "literal") {
    if (isRustAbsenceCarrier(carrier)) return predicate.negated;
    const category = getRustTypeofRuntimeKind(carrier, definitions);
    const numeric = (category === "number" || category === "bigint") &&
      (predicate.category === "number" || predicate.category === "bigint");
    return typeof category !== "string" || category === predicate.category || numeric ? undefined : predicate.negated;
  }
  const test = selectRustClosedTypeTestPlan(carrier, predicate, projectTypes, definitions);
  return test?.kind === "constant" ? test.value
    : predicate.kind === "error" && predicate.errorKind === "any" && test?.kind === "error" &&
      test.lowering === "native-error" ? true
    : test?.kind === "project" && test.plan.lowering.kind === "constant" ? test.plan.lowering.value : undefined;
}
