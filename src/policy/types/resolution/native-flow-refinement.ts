import type { Node, Type } from "@tsonic/tsts";
import { selectSourceGuardedValueMembers, selectSourceGuardedTypeMembers, selectSourceNativeGuardResult, selectSourceNativeValueGuard, type SourceValueFlowQueryContext, type SourceNativeGuard, type SourceNativeValueGuard } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustClosedTypePredicate } from "../../../target-model/operations/type-tests.js";
import { rustUnionLeaves } from "../../../target-model/types/union-relations.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { selectRustClosedTypeTestPlan } from "../../operations/operators/type-tests.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import { isRustAbsenceCarrier, rustAbsenceTargetType } from "../../../target-model/types/carriers/native.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

export function selectRustNativeFlowMembers(
  context: SourceValueFlowQueryContext,
  reference: Node,
  sourceCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
  resolveNominal: (guard: Extract<SourceNativeValueGuard, { readonly kind: "nominal" }>) => TargetTypeRef | undefined,
): ReturnType<typeof rustUnionLeaves> {
  const members = rustUnionLeaves(sourceCarrier, definitions) ?? [{ carrier: sourceCarrier, path: [] }];
  return selectSourceGuardedValueMembers(context, reference, members,
    expression => selectNativeGuard(context, expression, selectGuard, resolveNominal),
    (member, predicate) => testNativeCarrier(member.carrier, predicate, projectTypes, definitions));
}

type Predicate = RustClosedTypePredicate | { readonly kind: "typeof"; readonly value: string; readonly negated: boolean }
  | Extract<SourceNativeValueGuard, { readonly kind: "literal" }>
  | { readonly kind: "absence"; readonly negated: boolean };

export function selectRustNativeGuardResult(
  context: SourceValueFlowQueryContext,
  expression: Node,
  resolveCarrier: (reference: Node) => TargetTypeRef | undefined,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): boolean | undefined {
  return selectSourceNativeGuardResult(context, expression, reference => {
    const sourceCarrier = resolveCarrier(reference);
    if (sourceCarrier === undefined) return undefined;
    const present = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
    const payloads = rustUnionLeaves(present, definitions)?.map(member => member.carrier) ?? [present];
    return present === sourceCarrier ? payloads : [...payloads, rustAbsenceTargetType()];
  }, selected => {
    const guard = selectSourceNativeValueGuard(context, selected);
    return guard?.kind === "typeof" || guard?.kind === "absence"
      ? { sourceOperand: guard.sourceOperand, predicate: guard } : undefined;
  },
    (member, predicate) => testNativeCarrier(member, predicate, projectTypes, definitions));
}

export function selectRustNativeFlowTypeMembers(
  context: SourceValueFlowQueryContext,
  reference: Node,
  sourceType: Type,
  resolveCarrier: (type: Type) => TargetTypeRef | undefined,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
  resolveNominal: (guard: Extract<SourceNativeValueGuard, { readonly kind: "nominal" }>) => TargetTypeRef | undefined,
): readonly Type[] | undefined {
  return selectSourceGuardedTypeMembers(context, reference, sourceType,
    expression => selectNativeGuard(context, expression, selectGuard, resolveNominal),
    (type, predicate) => {
      const carrier = resolveCarrier(type);
      return carrier === undefined ? undefined : testNativeCarrier(carrier, predicate, projectTypes, definitions);
    });
}

function selectNativeGuard(
  context: SourceValueFlowQueryContext,
  expression: Node,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
  resolveNominal: (guard: Extract<SourceNativeValueGuard, { readonly kind: "nominal" }>) => TargetTypeRef | undefined,
): SourceNativeGuard<Predicate> | undefined {
  const selected = selectGuard(expression);
  if (selected !== undefined) return selected;
  const native = selectSourceNativeValueGuard(context, expression);
  if (native?.kind === "absence") return { sourceOperand: native.sourceOperand, predicate: native };
  if (native?.kind === "typeof") return { sourceOperand: native.sourceOperand, predicate: native };
  if (native?.kind === "literal") return { sourceOperand: native.sourceOperand, predicate: native };
  if (native?.kind === "nominal") {
    const targetCarrier = resolveNominal(native);
    if (targetCarrier !== undefined) return { sourceOperand: native.sourceOperand, predicate: { kind: "nominal", targetCarrier } };
  }
  return undefined;
}

function testNativeCarrier(
  carrier: TargetTypeRef,
  predicate: Predicate,
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
