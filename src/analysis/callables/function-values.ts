import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableTargetType } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableTargetType, rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableOrigin } from "../../policy/types/callables/callable-origins.js";
import { resolveRustCallableEnvironment, bindRustCallableEnvironment } from "../../policy/types/resolution/callable-environments.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/names/type-parameters.js";
import { rustHigherRankedNativeFunctionCarrier } from "./higher-ranked-function.js";
import { rustResolutionContext } from "../program/walk.js";

export function rustSourceFunctionValueCarrier(
  walk: RustFactWalk, declaration: Node, parameters: readonly RustSourceParameterAbi[], result: TargetTypeRef,
): TargetTypeRef | undefined {
  const contract = walk.context.sourceLifetimes.contractFor(declaration);
  const quantified = contract?.parameters.filter(parameter => parameter.kind === "type") ?? [];
  if (quantified.length !== 0 || rustNativeFutureCallableResult(result) !== undefined) {
    const context = rustResolutionContext(walk, declaration);
    const origin = rustCallableOrigin(walk.context.ast, declaration);
    const environment = resolveRustCallableEnvironment(declaration, context, walk.operationOptions, new Set());
    return origin === undefined || environment === undefined ? undefined : bindRustCallableEnvironment(
      rustGenericCallableTargetType(quantified.map(rustTypeParameterFromSourceContract),
        parameters.map(parameter => parameter.parameterCarrier), result, origin, environment), context);
  }
  return rustHigherRankedNativeFunctionCarrier(walk, declaration, parameters, result) ?? rustCallableTargetType(
    parameters.map(parameter => parameter.parameterCarrier), result, { kind: "static" });
}
