import type { Node } from "@tsonic/tsts";
import { selectSourceGuardedValueMembers, type SourceValueFlowQueryContext, type SourceNativeGuard } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustClosedTypePredicate } from "../../../target-model/operations/type-tests.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { selectRustClosedTypeTestPlan } from "../../operations/operators/type-tests.js";
import type { RustProjectTypePolicy } from "../project-types.js";

export function selectRustNativeFlowMembers(
  context: SourceValueFlowQueryContext,
  reference: Node,
  sourceCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
  selectGuard: (expression: Node) => SourceNativeGuard<RustClosedTypePredicate> | undefined,
): ReturnType<typeof rustUnionAlternatives> {
  const members = rustUnionAlternatives(sourceCarrier, definitions);
  if (members === undefined) return undefined;
  return selectSourceGuardedValueMembers(context, reference, members, selectGuard,
    (member, predicate) => {
      const test = selectRustClosedTypeTestPlan(member.carrier, predicate, projectTypes, definitions);
      return test?.kind === "constant" ? test.value : undefined;
    });
}
