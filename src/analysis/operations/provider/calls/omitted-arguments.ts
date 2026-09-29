import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustProviderOperationTemplate, RustProviderConstantArgument } from "../../../../target-model/operations/model.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";

export function materializeRustOmittedCallArguments(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  context: Pick<RustOperationPolicyContext, "currentSemantics">,
): RustProviderOperationTemplate | undefined {
  const providedCount = request.source.sourceArguments.length;
  const carriers = template.parameterCarriers;
  if (carriers === undefined || carriers.length <= providedCount) return template;
  const slots = context.currentSemantics.operations.callParameterSlots(request.source);
  if (slots === undefined || slots.length !== carriers.length || slots.some((slot, index) =>
    slot.sourceParameterIndex !== index || slot.form === "rest" ||
    index >= providedCount && (slot.form !== "optional" || rustOptionElementCarrier(carriers[index]) === undefined))) return undefined;
  if ((template.evaluationOnlySourceArgumentIndexes?.length ?? 0) !== 0 ||
    request.source.sourceArgumentBindings.length !== providedCount ||
    request.source.sourceArgumentBindings.some((binding, index) => binding.sourceArgumentIndex !== index ||
      binding.sourceParameterIndex !== index || binding.sourceForm !== "value" || binding.sourceParameterForm !== "parameter")) return undefined;
  const form = template.target;
  if (form.form !== "call" && form.form !== "receiver-method" && form.form !== "free-call") return undefined;
  const order = form.argOrder ?? carriers.map((_carrier, index) => index);
  if (order.length !== carriers.length || new Set(order).size !== order.length || order.some(index =>
    !Number.isSafeInteger(index) || index < 0 || index >= carriers.length)) return undefined;
  const omitted: RustProviderConstantArgument[] = [];
  for (const [targetIndex, sourceIndex] of order.entries()) {
    if (sourceIndex < providedCount) {
      if (omitted.length !== 0) return undefined;
      continue;
    }
    if ((form.argModes?.[targetIndex] ?? "value") !== "value" || form.argConversions?.[targetIndex] !== undefined) return undefined;
    const element = rustOptionElementCarrier(carriers[sourceIndex]);
    if (element === undefined) return undefined;
    omitted.push({ kind: "none", element });
  }
  return {
    ...template,
    parameterCarriers: carriers.slice(0, providedCount),
    target: { ...form,
      ...(form.argOrder === undefined ? {} : { argOrder: order.slice(0, providedCount) }),
      ...(form.argModes === undefined ? {} : { argModes: form.argModes.slice(0, providedCount) }),
      ...(form.argConversions === undefined ? {} : { argConversions: form.argConversions.slice(0, providedCount) }),
      trailingArguments: [...omitted, ...(form.trailingArguments ?? [])],
    },
  };
}
