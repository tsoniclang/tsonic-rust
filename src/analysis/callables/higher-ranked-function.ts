import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustFunctionValueLifetimeBinding } from "../../target-model/lifetimes/identity.js";
import { substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";

export function rustHigherRankedNativeFunctionCarrier(
  walk: RustFactWalk,
  declaration: Node,
  parameters: readonly RustSourceParameterAbi[],
  result: TargetTypeRef,
): TargetTypeRef | undefined {
  if (rustNativeFutureCallableResult(result) !== undefined) return undefined;
  const contract = walk.context.sourceLifetimes.contractFor(declaration);
  const lifetimeParameters = contract?.parameters.filter((parameter): parameter is Extract<
    typeof parameter,
    { readonly kind: "lifetime" }
  > => parameter.kind === "lifetime") ?? [];
  if (contract === undefined || lifetimeParameters.length === 0 ||
    lifetimeParameters.length !== contract.parameters.length) {
    return undefined;
  }
  if (contract.lifetimeBinder !== undefined) {
    return Object.freeze({
      kind: "function-pointer",
      args: Object.freeze(parameters.map((parameter) => parameter.parameterCarrier)),
      result,
      lifetimeBinder: contract.lifetimeBinder,
    });
  }
  const declarationIdentity = sourceNodeIdentity(walk.context.ast, declaration);
  if (declarationIdentity === undefined) {
    return undefined;
  }
  const binding = rustFunctionValueLifetimeBinding(declarationIdentity, lifetimeParameters);
  if (binding === undefined) return undefined;
  const substitute = (carrier: TargetTypeRef): TargetTypeRef =>
    substituteRustTargetGenerics(carrier, new Map(), binding.substitutions);
  return Object.freeze({
    kind: "function-pointer",
    args: Object.freeze(parameters.map((parameter) => substitute(parameter.parameterCarrier))),
    result: substitute(result),
    abi: Object.freeze(["target-default"]),
    lifetimeBinder: binding.binder,
  });
}
