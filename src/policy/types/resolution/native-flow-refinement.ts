import type { Node, Type } from "@tsonic/tsts";
import { selectSourceGuardedValueMembers, selectSourceGuardedTypeMembers, selectSourceNativeValueGuard, type SourceValueFlowQueryContext, type SourceNativeGuard } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustClosedTypePredicate } from "../../../target-model/operations/type-tests.js";
import { rustUnionLeaves } from "../../../target-model/types/union-relations.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { selectRustClosedTypeTestPlan } from "../../operations/operators/type-tests.js";
import type { RustProjectTypePolicy } from "../project-types.js";

export function selectRustNativeFlowMembers(
  context: SourceValueFlowQueryContext,
  reference: Node,
  sourceCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
): ReturnType<typeof rustUnionLeaves> {
  const members = rustUnionLeaves(sourceCarrier, definitions);
  if (members === undefined) return undefined;
  return selectSourceGuardedValueMembers(context, reference, members,
    expression => selectNativeGuard(context, expression, projectTypes, selectGuard),
    (member, predicate) => testNativeCarrier(member.carrier, predicate, projectTypes, definitions));
}

type Predicate = RustClosedTypePredicate | { readonly kind: "typeof"; readonly value: string; readonly negated: boolean };

export function selectRustNativeFlowTypeMembers(
  context: SourceValueFlowQueryContext,
  reference: Node,
  sourceType: Type,
  resolveCarrier: (type: Type) => TargetTypeRef | undefined,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
): readonly Type[] | undefined {
  return selectSourceGuardedTypeMembers(context, reference, sourceType,
    expression => selectNativeGuard(context, expression, projectTypes, selectGuard),
    (type, predicate) => {
      const carrier = resolveCarrier(type);
      return carrier === undefined ? undefined : testNativeCarrier(carrier, predicate, projectTypes, definitions);
    });
}

function selectNativeGuard(
  context: SourceValueFlowQueryContext,
  expression: Node,
  projectTypes: RustProjectTypePolicy,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
): SourceNativeGuard<Predicate> | undefined {
  const native = selectSourceNativeValueGuard(context, expression);
  if (native?.kind === "typeof") return { sourceOperand: native.sourceOperand, predicate: native };
  if (native?.kind === "nominal") {
    const definition = projectTypes.definitionForDeclaration(native.declaration);
    if (definition?.kind === "class" && definition.genericParameters.length === 0) {
      return { sourceOperand: native.sourceOperand, predicate: { kind: "nominal", targetCarrier: projectTypes.openCarrier(definition) } };
    }
  }
  return selectGuard(expression);
}

function testNativeCarrier(
  carrier: TargetTypeRef,
  predicate: Predicate,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): boolean | undefined {
  if (predicate.kind === "typeof") {
    const category = getRustTypeofRuntimeKind(carrier, definitions);
    return typeof category === "string" ? (category === predicate.value) !== predicate.negated : undefined;
  }
  const test = selectRustClosedTypeTestPlan(carrier, predicate, projectTypes, definitions);
  return test?.kind === "constant" ? test.value
    : test?.kind === "project" && test.plan.lowering.kind === "constant" ? test.plan.lowering.value : undefined;
}
