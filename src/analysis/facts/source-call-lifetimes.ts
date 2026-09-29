import type { RustSelectedTargetSignature, TargetTypeRef } from "../../target-model/types/model.js";
import { instantiateRustElidedCallResult } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { KindSpreadElement, Node_Expression } from "@tsonic/target-api/source";

export function rustSourceCallArgumentCarriers(
  call: Node, ast: AstReader, facts: Pick<RustPlanQueries, "getRuntimeCarrierFact">,
): readonly (TargetTypeRef | undefined)[] {
  return ast.arguments(call).map(argument => {
    const source = argument !== undefined && ast.kindName(argument) === KindSpreadElement ? Node_Expression(ast, argument) : argument;
    return facts.getRuntimeCarrierFact(source)?.carrier;
  });
}

export function rustSourceCallResultWithInputLifetimes(
  result: TargetTypeRef,
  parameters: readonly TargetTypeRef[],
  bindings: RustSelectedTargetSignature["sourceArgumentBindings"],
  arguments_: readonly (TargetTypeRef | undefined)[],
): TargetTypeRef {
  const inputs = (bindings ?? []).flatMap(binding => {
    const argument = arguments_[binding.sourceArgumentIndex];
    if (argument === undefined || binding.sourceForm === "spread-sequence" ||
      binding.sourceParameterForm === "rest-element") return [];
    const carrier = binding.sourceForm === "spread-element"
      ? binding.spreadElementIndex === undefined ? undefined : rustSpreadElementCarrier(argument, binding.spreadElementIndex)
      : argument;
    return carrier === undefined ? [] : [{ parameterIndex: binding.sourceParameterIndex, carrier }];
  });
  return instantiateRustElidedCallResult(result, parameters, inputs);
}
