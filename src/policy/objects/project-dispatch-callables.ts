import type { RustProjectCallablePolicyInput } from "../model/project-dispatch-callables.js";
import type { RustProjectCallableSignature } from "../../target-model/records/project-classes.js";
import { isRustUnitCarrier, isRustNeverCarrier } from "../../target-model/types/index.js";

export function selectRustProjectCallableSignature(input: RustProjectCallablePolicyInput): RustProjectCallableSignature | undefined {
  if (input.generator || input.asynchronous === "native-future" || input.authoredAsync && input.asynchronous !== "js-promise" ||
    input.typeParameters.some(identity => identity === undefined || identity.length === 0)) return undefined;
  return Object.freeze({ typeParameters: Object.freeze(input.typeParameters as readonly string[]), returnCarrier: input.result,
    omitReturn: isRustUnitCarrier(input.result) || input.effects.invocation === "fallible" && isRustNeverCarrier(input.result),
    fallible: input.effects.invocation === "fallible", errorCarrier: input.error, safety: input.safety });
}
