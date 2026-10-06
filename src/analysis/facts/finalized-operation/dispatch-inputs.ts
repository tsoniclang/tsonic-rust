import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import type { RustResolvedDispatchContextInput } from "../../../target-model/operations/dispatch-contexts.js";
import { isRustResolvedDispatchContextInput, rustProviderOperationFormAcceptsDispatchInputs } from "../../../policy/operations/dispatch-contexts.js";
import { carrierAfterMode } from "./conversions.js";
import type { RustFinalizedOperationAbi, RustFinalizedTargetInput } from "./model.js";

export function insertRustDispatchContextInputs(
  mapping: Pick<RustFinalizedOperationAbi, "targetReceiver" | "targetArguments">,
  inputs: readonly RustResolvedDispatchContextInput[],
  form: RustFinalizedOperationAbi["target"],
): Pick<RustFinalizedOperationAbi, "targetReceiver" | "targetArguments"> | undefined {
  if (!isDenseDataArray(inputs) || !inputs.every(isRustResolvedDispatchContextInput) ||
    inputs.length > 0 && !rustProviderOperationFormAcceptsDispatchInputs(form)) return undefined;
  if (inputs.length === 0) return mapping;
  const count = mapping.targetArguments.length + inputs.length;
  const byIndex = new Map(inputs.map(input => [input.targetArgumentIndex, input]));
  if (byIndex.size !== inputs.length || inputs.some(input => input.targetArgumentIndex >= count)) return undefined;
  const targetArguments: RustFinalizedTargetInput[] = [];
  let sourceCursor = 0;
  for (let index = 0; index < count; index += 1) {
    const input = byIndex.get(index);
    if (input === undefined) {
      targetArguments.push(mapping.targetArguments[sourceCursor++]!);
      continue;
    }
    const parameterCarrier = carrierAfterMode(input.carrier, input.mode);
    if (parameterCarrier === undefined) return undefined;
    targetArguments.push(Object.freeze({
      source: Object.freeze({ kind: "dispatch-context" as const, contextId: input.contextId, view: input.view }),
      carrier: input.carrier, mode: input.mode,
      parameterCarrier: input.mode === "ref" ? Object.freeze(parameterCarrier) : parameterCarrier,
    }));
  }
  return { targetReceiver: mapping.targetReceiver, targetArguments };
}
