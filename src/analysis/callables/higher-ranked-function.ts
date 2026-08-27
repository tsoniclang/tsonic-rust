import type { Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustLifetimeKey,
} from "../../target-model/lifetimes/index.js";
import { substituteRustTargetGenerics } from "../../target-model/types/index.js";

export function rustHigherRankedNativeFunctionCarrier(
  walk: RustFactWalk,
  declaration: Node,
  parameters: readonly RustSourceParameterAbi[],
  result: TargetTypeRef,
): TargetTypeRef | undefined {
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
  const binderIdentity = `function-value-lifetime-binder\0${declarationIdentity}`;
  const lifetimes = lifetimeParameters.map((parameter, index) => ({
    parameter,
    bound: Object.freeze({
      kind: "bound" as const,
      binderIdentity,
      identity: `${binderIdentity}\0${index}`,
      name: parameter.lifetime.name,
    }),
  }));
  const substitutions = new Map(lifetimes.map(({ parameter, bound }) => [
    rustLifetimeKey(parameter.lifetime),
    bound,
  ] as const));
  const substitute = (carrier: TargetTypeRef): TargetTypeRef =>
    substituteRustTargetGenerics(carrier, new Map(), substitutions);
  return Object.freeze({
    kind: "function-pointer",
    args: Object.freeze(parameters.map((parameter) => substitute(parameter.parameterCarrier))),
    result: substitute(result),
    abi: Object.freeze(["target-default"]),
    lifetimeBinder: Object.freeze({
      identity: binderIdentity,
      parameters: Object.freeze(lifetimes.map(({ parameter, bound }) => Object.freeze({
        lifetime: bound,
        outlives: Object.freeze(parameter.outlives.map((lifetime) =>
          lifetime.kind === "parameter"
            ? substitutions.get(rustLifetimeKey(lifetime)) ?? lifetime
            : lifetime)),
      }))),
    }),
  });
}
