import type { Node } from "@tsonic/tsts";
import type { RustGeneratorFact } from "../../../../target-model/records/callables-and-resources.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../types/render.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { getRustGeneratorProtocol } from "../../../../target-model/types/carriers/callables.js";

export function resolveRustGeneratorBodyErrorType(
  declaration: Node, context: RustPlanContext,
): RustType {
  const outward = context.input.program.records.callableReturn.get(declaration)?.outward;
  const physical = outward === undefined ? undefined : getRustGeneratorProtocol(outward)?.physical;
  if (physical === undefined) failRustPlannerInvariant("An admitted generator requires its selected physical error and reentry protocol.", declaration);
  return rustTypeFromCarrierInContext(physical.errorCarrier, context)
    ?? failRustPlannerInvariant("An admitted generator requires its renderable selected native error carrier.", declaration);
}

export function resolveRustJsPromiseReturnType(
  declaration: Node, context: RustPlanContext,
): RustType {
  const carrier = context.input.program.records.callableReturn.get(declaration)?.invocation;
  if (carrier === undefined) failRustPlannerInvariant("An admitted Promise declaration requires its native invocation-result carrier.", declaration);
  return rustReturnTypeFromCarrierInContext(carrier, context)
    ?? failRustPlannerInvariant("An admitted Promise declaration requires its renderable native result carrier.", declaration);
}

export function resolveRustCallableOutwardReturnType(
  declaration: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext,
): RustType {
  if (carrier === undefined) failRustPlannerInvariant("An admitted callable requires its native logical result carrier.", declaration);
  const selected = context.input.program.records.callableReturn.get(declaration)?.outward;
  if (selected === undefined) failRustPlannerInvariant("An admitted callable requires its native outward-result carrier.", declaration);
  return rustReturnTypeFromCarrierInContext(selected, context)
    ?? failRustPlannerInvariant("An admitted callable requires its renderable native outward result.", declaration);
}

export function resolveRustCallableBodyReturnType(
  outwardReturnType: RustType | undefined,
  generator: RustGeneratorFact | undefined,
  context: RustPlanContext,
): RustType {
  if (generator === undefined) {
    return outwardReturnType ?? { kind: "unit" };
  }
  return rustTypeFromCarrierInContext(generator.returnType, context)
    ?? failRustPlannerInvariant("An admitted generator requires its renderable native body result.");
}
