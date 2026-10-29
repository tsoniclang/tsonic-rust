import type { Node, Type } from "@tsonic/tsts";
import { selectSourceGuardedValueMembers, selectSourceGuardedTypeMembers, selectSourceNativeGuardResult, selectSourceNativeValueGuard, type SourceValueFlowQueryContext, type SourceNativeGuard, type SourceNativeValueGuard } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import type { RustClosedTypePredicate } from "../../../../target-model/operations/type-tests.js";
import { rustUnionLeaves } from "../../../../target-model/types/union-relations.js";

import type { RustProjectTypePolicy } from "../../../../target-model/types/project-types.js";
import { rustAbsenceTargetType } from "../../../../target-model/types/carriers/native.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/carriers/optional.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustSelectedUnion } from "./inferred-unions.js";
import type { RustUnionLeaf } from "../../../../target-model/types/union-relations.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";

import { selectRustNativeCarrierPredicate, type RustNativeFlowPredicate } from "../../../../policy/operations/flow/native-predicates.js";
export function resolveRustNativeFlowCarrier(
  sourceType: Type,
  members: readonly RustUnionLeaf[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (members.length === 1) return members[0]!.carrier;
  const variants = members.map(member => {
    const step = member.path[member.path.length - 1];
    const union = step === undefined ? undefined : options.sourceTypes.sourceUnionForCarrier(step.union);
    const variant = union?.variants.find(variant => variant.name === step?.variant.name);
    return variant !== undefined && rustTargetTypeRefEquals(variant.carrier, member.carrier) ? variant : undefined;
  });
  return variants.some(variant => variant === undefined) ? undefined
    : resolveRustSelectedUnion(sourceType, variants as NonNullable<typeof variants[number]>[], context, options);
}

export function selectRustNativeFlowMembers(
  context: SourceValueFlowQueryContext,
  reference: Node,
  sourceCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
  resolveNominal: (guard: Extract<SourceNativeValueGuard, { readonly kind: "nominal" }>) => TargetTypeRef | undefined,
): ReturnType<typeof rustUnionLeaves> {
  const members = nativeFlowInputMembers(sourceCarrier, definitions);
  const selected = selectSourceGuardedValueMembers(context, reference, members,
    expression => selectNativeGuard(context, expression, selectGuard, resolveNominal),
    (member, predicate) => selectRustNativeCarrierPredicate(member.carrier, predicate, projectTypes, definitions));
  return selected?.kind === "resolved" ? selected.members : undefined;
}

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
    return nativeFlowInputMembers(sourceCarrier, definitions).map(member => member.carrier);
  }, selected => {
    const guard = selectSourceNativeValueGuard(context, selected);
    return guard?.kind === "typeof" || guard?.kind === "absence"
      ? { sourceOperand: guard.sourceOperand, predicate: guard } : undefined;
  },
    (member, predicate) => selectRustNativeCarrierPredicate(member, predicate, projectTypes, definitions));
}

function nativeFlowInputMembers(sourceCarrier: TargetTypeRef, definitions: RustTypeDefinitions): readonly RustUnionLeaf[] {
  const present = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const members = rustUnionLeaves(present, definitions) ?? [{ carrier: present, path: [] }];
  return present === sourceCarrier ? members : [...members, { carrier: rustAbsenceTargetType(), path: [] }];
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
      return carrier === undefined ? undefined : selectRustNativeCarrierPredicate(carrier, predicate, projectTypes, definitions);
    });
}

function selectNativeGuard(
  context: SourceValueFlowQueryContext,
  expression: Node,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
  resolveNominal: (guard: Extract<SourceNativeValueGuard, { readonly kind: "nominal" }>) => TargetTypeRef | undefined,
): SourceNativeGuard<RustNativeFlowPredicate> | undefined {
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
