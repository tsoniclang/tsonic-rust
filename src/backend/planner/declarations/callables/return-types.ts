import type { Node } from "@tsonic/tsts";
import type { RustGeneratorFact } from "../../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../types/render.js";

export function resolveRustJsPromiseReturnType(
  declaration: Node, context: RustPlanContext,
): RustType | undefined {
  const carrier = context.input.program.callableValues.nativeProducers.invocationResultFor(declaration);
  return carrier === undefined ? undefined : rustReturnTypeFromCarrierInContext(carrier, context);
}

export function resolveRustCallableOutwardReturnType(
  declaration: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext,
): RustType | undefined {
  if (carrier === undefined) return undefined;
  const selected = context.input.program.callableValues.nativeProducers.outwardReturnFor(declaration);
  return selected === undefined ? undefined : rustReturnTypeFromCarrierInContext(selected, context);
}

export function resolveRustCallableBodyReturnType(
  outwardReturnType: RustType | undefined,
  generator: RustGeneratorFact | undefined,
  context: RustPlanContext,
): RustType | undefined {
  if (generator === undefined) {
    return outwardReturnType ?? { kind: "unit" };
  }
  return rustTypeFromCarrierInContext(generator.returnType, context);
}
