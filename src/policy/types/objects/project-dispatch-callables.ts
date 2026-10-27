import type { RustProjectCallablePolicyInput } from "../../model/project-dispatch-callables.js";
import type { RustProjectCallableSignature } from "../../../target-model/records/objects/project-classes.js";
import { isRustUnitCarrier, isRustNeverCarrier } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function selectRustProjectForwarder(source: TargetTypeRef | undefined, target: TargetTypeRef | undefined, accessor: boolean): "adapter" | "direct" {
  return !accessor && source === undefined || rustTargetTypeRefEquals(source, target) ? "adapter" : "direct";
}

export function selectRustProjectCallableSignature(input: RustProjectCallablePolicyInput): Pick<RustProjectCallableSignature,
  "typeParameters" | "returnCarrier" | "omitReturn" | "fallible" | "errorCarrier" | "safety"> | undefined {
  if (input.generator || input.asynchronous === "native-future" || input.authoredAsync && input.asynchronous !== "js-promise" ||
    input.typeParameters.some(identity => identity === undefined || identity.length === 0)) return undefined;
  return Object.freeze({ typeParameters: Object.freeze(input.typeParameters as readonly string[]), returnCarrier: input.result,
    omitReturn: isRustUnitCarrier(input.result) || input.effects.invocation === "fallible" && isRustNeverCarrier(input.result),
    fallible: input.effects.invocation === "fallible", errorCarrier: input.error, safety: input.safety });
}
