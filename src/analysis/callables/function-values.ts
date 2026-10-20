import type { RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableTargetType, rustCallableProtocol, rustCallableInputProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableTargetType, rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableOrigin } from "../../policy/types/callables/callable-origins.js";
import { resolveRustCallableEnvironment, bindRustCallableEnvironment } from "../types/resolution/callable-environments.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/names/type-parameters.js";
import { rustHigherRankedNativeFunctionCarrier } from "./higher-ranked-function.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustCallableStorageCarrier } from "../types/resolution/source-evidence.js";
import { rustRetainedValueLifetime } from "./retained-values.js";

export function rustSourceClosureValueCarrier(
  walk: RustFactWalk, declaration: Node, selected: TargetTypeRef, captures?: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  const context = rustResolutionContext(walk, declaration, "value");
  const protocol = rustCallableProtocol(selected);
  const construction = rustCallableInputProtocol(selected) === undefined ? selected : protocol === undefined ? undefined
    : rustCallableTargetType(protocol.parameters, protocol.result, undefined, protocol.error);
  const storage = resolveRustCallableStorageCarrier(construction, context, walk.operationOptions, new Set());
  const stored = rustCallableProtocol(storage);
  if (storage === undefined || stored?.lifetime === undefined) return storage;
  const environment = captures ?? resolveRustCallableEnvironment(declaration, context, walk.operationOptions, new Set());
  const lifetime = environment === undefined ? undefined : rustRetainedValueLifetime(declaration, environment, walk);
  return lifetime === undefined ? undefined : rustCallableTargetType(stored.parameters, stored.result, lifetime, stored.error);
}

export function rustSourceFunctionValueCarrier(
  walk: RustFactWalk, declaration: Node, parameters: readonly RustSourceParameterAbiFact[], result: TargetTypeRef,
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
