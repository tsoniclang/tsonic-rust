import type { RustFinalizedArrayInput, RustFinalizedConstantInput, RustFinalizedDispatchContextInput, RustFinalizedOperationAbi, RustFinalizedSliceInput, RustFinalizedSourceInput, RustFinalizedTaggedArrayInput, RustFinalizedTargetInput } from "../records/operations/finalized-operation.js";

export function isRustFinalizedSourceInput(input: RustFinalizedTargetInput): input is RustFinalizedSourceInput {
  return input.source.kind === "receiver" || input.source.kind === "argument";
}

export function isRustFinalizedSliceInput(input: RustFinalizedTargetInput): input is RustFinalizedSliceInput {
  return input.source.kind === "argument-slice";
}

export function isRustFinalizedArrayInput(input: RustFinalizedTargetInput): input is RustFinalizedArrayInput {
  return input.source.kind === "argument-array";
}

export function isRustFinalizedTaggedArrayInput(input: RustFinalizedTargetInput): input is RustFinalizedTaggedArrayInput {
  return input.source.kind === "argument-tagged-array";
}

export function isRustFinalizedConstantInput(input: RustFinalizedTargetInput): input is RustFinalizedConstantInput {
  return input.source.kind === "constant";
}

export function isRustFinalizedDispatchContextInput(input: RustFinalizedTargetInput): input is RustFinalizedDispatchContextInput {
  return input.source.kind === "dispatch-context";
}

export function rustFinalizedSourceInputs(abi: RustFinalizedOperationAbi): readonly RustFinalizedSourceInput[] {
  return [
    ...(abi.targetReceiver.kind === "input" ? [abi.targetReceiver.input] : []),
    ...abi.targetArguments.flatMap(input =>
      isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input) ? input.elements :
        isRustFinalizedTaggedArrayInput(input) ? input.elements.map(element => element.input) :
        isRustFinalizedConstantInput(input) || isRustFinalizedDispatchContextInput(input) ? [] : [input]),
  ];
}

export function rustFinalizedTargetInputMayMutateSource(
  input: RustFinalizedTargetInput,
): boolean {
  if (isRustFinalizedSourceInput(input)) {
    return input.mode === "mut-ref";
  }
  if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
    return input.elements.some(rustFinalizedTargetInputMayMutateSource);
  }
  if (isRustFinalizedTaggedArrayInput(input)) {
    return input.elements.some((element) =>
      rustFinalizedTargetInputMayMutateSource(element.input));
  }
  return false;
}
