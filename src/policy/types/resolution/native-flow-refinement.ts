import type { Node } from "@tsonic/tsts";
import { selectSourceGuardedValueMembers, selectSourceNativeValueGuard, type SourceValueFlowQueryContext, type SourceNativeGuard } from "@tsonic/target-api/source";
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
  type Predicate = RustClosedTypePredicate | { readonly kind: "typeof"; readonly value: string; readonly negated: boolean };
  return selectSourceGuardedValueMembers<typeof members[number], Predicate>(context, reference, members, expression => {
    const native = selectSourceNativeValueGuard(context, expression);
    if (native?.kind === "typeof") return { sourceOperand: native.sourceOperand, predicate: native };
    if (native?.kind === "nominal") {
      const definition = projectTypes.definitionForDeclaration(native.declaration);
      if (definition?.kind === "class" && definition.genericParameters.length === 0) {
        return { sourceOperand: native.sourceOperand, predicate: { kind: "nominal", targetCarrier: projectTypes.openCarrier(definition) } };
      }
    }
    return selectGuard(expression);
  },
    (member, predicate) => {
      if (predicate.kind === "typeof") {
        const category = getRustTypeofRuntimeKind(member.carrier, definitions);
        return typeof category === "string" ? (category === predicate.value) !== predicate.negated : undefined;
      }
      const test = selectRustClosedTypeTestPlan(member.carrier, predicate, projectTypes, definitions);
      return test?.kind === "constant" ? test.value
        : test?.kind === "project" && test.plan.lowering.kind === "constant" ? test.plan.lowering.value : undefined;
    });
}
