import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustProviderOperationForm, RustProviderOperationTemplate } from "../../../facts/keys.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustOperationsProviderOptions } from "../model.js";
import { rustFixedArrayCarrierValue, rustTargetConstInteger } from "../../../../target-model/types/index.js";
import { selectRustRestSequenceConversion } from "../../../../policy/conversions/rest-sequence.js";
import { selectedCallArgumentNodes, selectedSourceValueCarrier } from "../operators.js";

export function selectedCallSourceParameterCarriers(
  request: RustCheckedCallSelectionInput,
  fact: RustProviderOperationTemplate,
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): ReadonlyMap<number, TargetTypeRef | undefined> | undefined {
  const compileTimeIndexes = new Set(fact.compileTimeSourceArgumentIndexes ?? []);
  const runtimeIndexes = selectedCallArgumentNodes(request)
    .map((_argument, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  const declaredBySourceIndex = new Map<number, TargetTypeRef | undefined>();
  for (const sourceIndex of runtimeIndexes) {
    const bindings = request.source.sourceArgumentBindings.filter((binding) =>
      binding.sourceArgumentIndex === sourceIndex);
    const first = bindings[0];
    if (first === undefined && fact.target.form === "call-value-slice" &&
      sourceIndex >= fact.target.leadingArguments.length &&
      request.source.sourceArguments[sourceIndex] !== undefined &&
      context.ast.is.IsSpreadElement(request.source.sourceArguments[sourceIndex]!.expression)) {
      const carrier = selectedSourceValueCarrier(request.source.sourceArguments[sourceIndex]!, context, options);
      const fixed = carrier === undefined ? undefined : rustFixedArrayCarrierValue(carrier);
      const empty = carrier?.kind === "tuple" && carrier.elements.length === 0 ||
        fixed !== undefined && rustTargetConstInteger(fixed.length) === 0n;
      const rest = request.source.sourceSelectedSignatureParameters.filter(parameter => parameter.rest);
      if (empty && rest.length === 1) {
        declaredBySourceIndex.set(sourceIndex, declared?.[rest[0]!.parameterIndex]);
        continue;
      }
    }
    if (first === undefined || bindings.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm) ||
      request.source.sourceSelectedSignatureParameters[first.sourceParameterIndex] === undefined) {
      return undefined;
    }
    declaredBySourceIndex.set(sourceIndex, declared?.[first.sourceParameterIndex]);
  }
  return declaredBySourceIndex;
}

export function selectedRestSequenceIsClosed(
  request: RustCheckedCallSelectionInput,
  index: number,
  carrier: TargetTypeRef | undefined,
  form: RustProviderOperationForm,
): boolean {
  if (carrier === undefined || form.form !== "call-value-slice" || index < form.leadingArguments.length) return false;
  const bindings = request.source.sourceArgumentBindings.filter(binding => binding.sourceArgumentIndex === index);
  const fixed = rustFixedArrayCarrierValue(carrier);
  const tupleLength = carrier.kind === "tuple" ? BigInt(carrier.elements.length)
    : fixed === undefined ? undefined : rustTargetConstInteger(fixed.length);
  const exactBindings = bindings.length === 1 && bindings[0]?.sourceForm === "spread-sequence" ||
    tupleLength !== undefined && BigInt(bindings.length) === tupleLength && bindings.every((binding, elementIndex) =>
      binding.sourceForm === "spread-element" && binding.spreadElementIndex === elementIndex);
  return exactBindings && selectRustRestSequenceConversion(
    carrier, form.elementCarrier, form.sequenceHolePolicy ?? "reject",
  ) !== undefined;
}
