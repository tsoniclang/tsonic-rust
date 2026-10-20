import type { RustProjectConstructorSignature } from "../../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCallableParameterPlan } from "../../declarations/callables/parameters.js";
import type { RustFunctionParam } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

export function planRustImplicitConstructorParameters(
  signature: RustProjectConstructorSignature,
  receiver: TargetTypeRef,
  context: RustPlanContext,
): RustCallableParameterPlan | undefined {
  const params: RustFunctionParam[] = [];
  const selected = context.input.program.records.implicitConstructorParameters.get(signature, receiver);
  if (selected === undefined) failRustPlannerInvariant("An inherited native constructor requires its sealed parameter ABI.", signature.declaration);
  for (const parameter of selected) {
    const type = rustTypeFromCarrierInContext(parameter.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An inherited constructor parameter requires its admitted native type.", parameter.declaration);
    params.push({ name: parameter.name, type, mutable: false });
  }
  return { params, prelude: [] };
}
