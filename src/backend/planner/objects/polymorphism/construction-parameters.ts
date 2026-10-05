import type { RustProjectConstructorSignature } from "../../../../analysis/project-types/type-policy.js";
import { rustSourceParameterAbiFactKey } from "../../../../analysis/facts/keys.js";
import { rustTargetIdentifier } from "../../../../target-model/names/identifiers.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCallableParameterPlan } from "../../declarations/callables/parameters.js";
import type { RustFunctionParam } from "../../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { diagnosticInput, isValidRustIdentifier, type RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

export function planRustImplicitConstructorParameters(
  signature: RustProjectConstructorSignature,
  receiver: TargetTypeRef,
  context: RustPlanContext,
): RustCallableParameterPlan | undefined {
  const params: RustFunctionParam[] = [];
  for (const parameter of signature.parameters) {
    const abi = context.input.program.facts.getFact(parameter.parameterDeclaration, rustSourceParameterAbiFactKey);
    const carrier = abi === undefined ? undefined : context.input.program.projectTypes.instantiateMemberCarrier(
      parameter.parameterDeclaration, receiver, abi.parameterCarrier);
    const type = rustTypeFromCarrierInContext(carrier, context);
    const name = rustTargetIdentifier(parameter.parameterName);
    if (type === undefined || !isValidRustIdentifier(name)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter.parameterDeclaration),
        "rust.backend.project-implicit-constructor-parameter",
        "An inherited effective constructor parameter has no exact instantiated Rust ABI.",
      ));
      return undefined;
    }
    params.push({ name, type, mutable: false });
  }
  return { params, prelude: [] };
}
