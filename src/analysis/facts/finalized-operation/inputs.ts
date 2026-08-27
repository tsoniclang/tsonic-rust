import { isRustCVariadicArgumentCarrier } from "../c-variadic.js";
import { isRustFinalizedArrayInput, isRustFinalizedSliceInput, isRustFinalizedSourceInput, isRustFinalizedTaggedArrayInput, sourceInput } from "./conversions.js";
import { rustSliceRefTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import type {
  RustArgumentMode,
  RustProviderConstantArgument,
  RustProviderOperationForm,
  RustValueConversion,
} from "../keys.js";
import type { FinalizeRustProviderOperationAbiOptions, RustFinalizedConstantInput, RustFinalizedOperationAbi, RustFinalizedSourceArgument, RustFinalizedSourceInput, RustFinalizedTargetInput } from "./model.js";
import type { RustFinalizedOperationKind } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function createInputFactory(
  receiverCarrier: TargetTypeRef | undefined,
  argumentCarriers: readonly TargetTypeRef[],
) {
  const receiver = (mode: RustArgumentMode): RustFinalizedSourceInput | undefined =>
    receiverCarrier === undefined
      ? undefined
      : sourceInput({ kind: "receiver" }, receiverCarrier, mode, undefined);
  const argument = (
    sourceIndex: number,
    mode: RustArgumentMode,
    conversion?: RustValueConversion,
  ): RustFinalizedSourceInput | undefined => {
    const carrier = argumentCarriers[sourceIndex];
    return carrier === undefined
      ? undefined
      : sourceInput({ kind: "argument", sourceIndex }, carrier, mode, conversion);
  };
  const argumentTo = (
    sourceIndex: number,
    mode: RustArgumentMode,
    targetCarrier: TargetTypeRef,
  ): RustFinalizedSourceInput | undefined => {
    const sourceCarrier = argumentCarriers[sourceIndex];
    if (sourceCarrier === undefined) {
      return undefined;
    }
    const conversion = selectRustSourceValueConversion(sourceCarrier, targetCarrier);
    const identical = rustTargetTypeRefEquals(sourceCarrier, targetCarrier);
    return !identical && conversion === undefined
      ? undefined
      : sourceInput({ kind: "argument", sourceIndex }, sourceCarrier, mode, conversion);
  };
  const sourceArgumentCarrier = (sourceIndex: number): TargetTypeRef | undefined =>
    argumentCarriers[sourceIndex];
  return { receiver, argument, argumentTo, sourceArgumentCarrier };
}

export function finalizeTargetInputs(
  operationKind: FinalizeRustProviderOperationAbiOptions["operationKind"],
  form: RustProviderOperationForm,
  input: ReturnType<typeof createInputFactory>,
  sourceArgumentCount: number,
): {
  readonly targetReceiver: RustFinalizedOperationAbi["targetReceiver"];
  readonly targetArguments: readonly RustFinalizedTargetInput[];
} | undefined {
  const none = { kind: "none" } as const;
  const indexes = Array.from({ length: sourceArgumentCount }, (_, index) => index);
  const ordered = (order: readonly number[] | undefined): readonly number[] => order ?? indexes;
  const mappedArguments = (
    order: readonly number[] | undefined,
    modes: readonly RustArgumentMode[] | undefined,
    conversions: readonly (RustValueConversion | undefined)[] | undefined,
  ): readonly RustFinalizedSourceInput[] | undefined => {
    const result = ordered(order).map((sourceIndex, targetIndex) =>
      input.argument(sourceIndex, modes?.[targetIndex] ?? "value", conversions?.[targetIndex]));
    return result.every((entry) => entry !== undefined)
      ? result as RustFinalizedSourceInput[]
      : undefined;
  };
  const constants = (values: readonly RustProviderConstantArgument[] | undefined): readonly RustFinalizedConstantInput[] =>
    (values ?? []).map((value) => ({ source: { kind: "constant", value } }));

  switch (form.form) {
    case "marker":
    case "path":
      return sourceArgumentCount === 0 ? { targetReceiver: none, targetArguments: [] } : undefined;
    case "static": {
      if (operationKind === "property" && sourceArgumentCount === 0) {
        return { targetReceiver: none, targetArguments: [] };
      }
      const value = operationKind === "property-set" && sourceArgumentCount === 1
        ? input.argument(0, "value")
        : undefined;
      return value === undefined ? undefined : { targetReceiver: none, targetArguments: [value] };
    }
    case "call": {
      const args = mappedArguments(form.argOrder, form.argModes, form.argConversions);
      return args === undefined ? undefined : {
        targetReceiver: none,
        targetArguments: [...args, ...constants(form.trailingArguments)],
      };
    }
    case "call-c-variadic": {
      const fixed = form.fixedArgumentModes.map((mode, sourceIndex) =>
        input.argument(sourceIndex, mode));
      const tail = indexes.slice(form.fixedArgumentModes.length).map((sourceIndex) => {
        const carrier = input.sourceArgumentCarrier(sourceIndex);
        return isRustCVariadicArgumentCarrier(carrier)
          ? input.argument(sourceIndex, "value")
          : undefined;
      });
      return fixed.some((entry) => entry === undefined) || tail.some((entry) => entry === undefined)
        ? undefined
        : {
            targetReceiver: none,
            targetArguments: [
              ...fixed as RustFinalizedSourceInput[],
              ...tail as RustFinalizedSourceInput[],
            ],
          };
    }
    case "free-call": {
      const receiver = input.receiver(form.receiverMode);
      const args = mappedArguments(form.argOrder, form.argModes, form.argConversions);
      return receiver === undefined || args === undefined ? undefined : {
        targetReceiver: none,
        targetArguments: [receiver, ...args, ...constants(form.trailingArguments)],
      };
    }
    case "receiver-method": {
      const receiver = input.receiver(form.mutatesReceiver === true ? "mut-ref" : "ref");
      const args = mappedArguments(form.argOrder, form.argModes, form.argConversions);
      return receiver === undefined || args === undefined ? undefined : {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: args,
      };
    }
    case "method": {
      const receiver = input.receiver("ref");
      const args = mappedArguments(undefined, undefined, undefined);
      return receiver === undefined || args === undefined ? undefined : {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: args,
      };
    }
    case "field": {
      const receiver = input.receiver(operationKind === "property-set" ? "mut-ref" : "ref");
      if (receiver === undefined) {
        return undefined;
      }
      if (operationKind === "property" && sourceArgumentCount === 0) {
        return { targetReceiver: { kind: "input", input: receiver }, targetArguments: [] };
      }
      const value = operationKind === "property-set" && sourceArgumentCount === 1
        ? input.argument(0, "value")
        : undefined;
      return value === undefined ? undefined : {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: [value],
      };
    }
    case "index": {
      const receiver = input.receiver(operationKind === "index-set" ? "mut-ref" : "ref");
      const index = input.argument(0, "value", form.indexConversion);
      if (operationKind === "index-set") {
        const value = input.argument(1, "value");
        return receiver === undefined || index === undefined || value === undefined || sourceArgumentCount !== 2
          ? undefined
          : {
              targetReceiver: { kind: "input", input: receiver },
              targetArguments: [index, value],
            };
      }
      return operationKind !== "indexer" || receiver === undefined || index === undefined || sourceArgumentCount !== 1 ? undefined : {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: [index],
      };
    }
    case "arg-method": {
      const receiver = input.argument(0, "value");
      const args = indexes.slice(1).map((index) => input.argument(index, "value"));
      return receiver === undefined || args.some((entry) => entry === undefined) ? undefined : {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: args as RustFinalizedSourceInput[],
      };
    }
    case "arg-receiver-method": {
      const receiver = input.argument(0, "ref");
      const sourceReceiver = input.receiver(form.argModes?.[0] ?? "value");
      const rest = indexes.slice(1).map((index, targetIndex) =>
        input.argument(
          index,
          form.argModes?.[targetIndex + 1] ?? "value",
          form.argConversions?.[targetIndex + 1],
        ));
      return receiver === undefined || sourceReceiver === undefined || rest.some((entry) => entry === undefined)
        ? undefined
        : {
            targetReceiver: { kind: "input", input: receiver },
            targetArguments: [sourceReceiver, ...rest as RustFinalizedSourceInput[]],
          };
    }
    case "arg-structural-method": {
      const receiver = input.argument(0, "value");
      const sourceReceiver = input.receiver(form.argModes[0]!);
      const rest = indexes.slice(1).map((index, targetIndex) =>
        input.argument(
          index,
          form.argModes[targetIndex + 1]!,
          form.argConversions?.[targetIndex + 1],
        ));
      return receiver === undefined || sourceReceiver === undefined ||
          rest.some((entry) => entry === undefined)
        ? undefined
        : {
            targetReceiver: { kind: "input", input: receiver },
            targetArguments: [
              sourceReceiver,
              ...rest as RustFinalizedSourceInput[],
              ...constants(form.trailingArguments),
            ],
          };
    }
    case "binary-operator": {
      const args = mappedArguments(undefined, undefined, undefined);
      return args?.length === 2 ? { targetReceiver: none, targetArguments: args } : undefined;
    }
    case "trait-call": {
      const receiver = form.receiverMode === undefined
        ? undefined
        : input.receiver(form.receiverMode);
      const args = mappedArguments(undefined, form.argModes, undefined);
      return args === undefined || (form.receiverMode !== undefined && receiver === undefined)
        ? undefined
        : {
            targetReceiver: none,
            targetArguments: [
              ...(receiver === undefined ? [] : [receiver]),
              ...args,
            ],
          };
    }
    case "associated-value":
    case "trait-associated-value":
      return sourceArgumentCount === 0
        ? { targetReceiver: none, targetArguments: [] }
        : undefined;
    case "call-str-slice": {
      const elements = indexes.map((index) => input.argument(index, "ref"));
      if (elements.some((entry) => entry === undefined)) {
        return undefined;
      }
      const closed = elements as RustFinalizedSourceInput[];
      const stringCarrier = rustStringTargetType();
      if (closed.some((entry) => !rustTargetTypeRefEquals(entry.sourceCarrier, stringCarrier))) {
        return undefined;
      }
      const elementCarrier = closed[0]?.parameterCarrier ?? {
        kind: "reference",
        referent: stringCarrier,
        mutable: false,
      } as const;
      return {
        targetReceiver: none,
        targetArguments: [{
          source: { kind: "argument-slice", sourceIndexes: indexes },
          elements: closed,
          elementCarrier,
          mode: "ref",
          parameterCarrier: rustSliceRefTargetType(elementCarrier),
        }],
      };
    }
    case "free-call-str-slice": {
      const receiver = input.receiver(form.receiverMode);
      const elements = indexes.map((index) => input.argument(index, "ref"));
      if (receiver === undefined || elements.some((entry) => entry === undefined)) {
        return undefined;
      }
      const closed = elements as RustFinalizedSourceInput[];
      const stringCarrier = rustStringTargetType();
      if (closed.some((entry) => !rustTargetTypeRefEquals(entry.sourceCarrier, stringCarrier))) {
        return undefined;
      }
      const elementCarrier = closed[0]?.parameterCarrier ?? {
        kind: "reference",
        referent: stringCarrier,
        mutable: false,
      } as const;
      return {
        targetReceiver: none,
        targetArguments: [
          receiver,
          {
            source: { kind: "argument-slice", sourceIndexes: indexes },
            elements: closed,
            elementCarrier,
            mode: "ref",
            parameterCarrier: rustSliceRefTargetType(elementCarrier),
          },
        ],
      };
    }
    case "call-value-slice": {
      const leading = form.leadingArguments.map((argument, sourceIndex) =>
        input.argumentTo(sourceIndex, argument.mode, argument.carrier));
      const sliceIndexes = indexes.slice(form.leadingArguments.length);
      const elements = sliceIndexes.map((sourceIndex) =>
        input.argumentTo(sourceIndex, "value", form.elementCarrier));
      if (leading.some((entry) => entry === undefined) || elements.some((entry) => entry === undefined)) {
        return undefined;
      }
      return {
        targetReceiver: none,
        targetArguments: [
          ...leading as RustFinalizedSourceInput[],
          {
            source: { kind: "argument-slice", sourceIndexes: sliceIndexes },
            elements: elements as RustFinalizedSourceInput[],
            elementCarrier: form.elementCarrier,
            mode: "ref",
            parameterCarrier: rustSliceRefTargetType(form.elementCarrier),
          },
        ],
      };
    }
    case "call-value-array": {
      const leading = form.leadingArguments.map((argument, sourceIndex) =>
        input.argumentTo(sourceIndex, argument.mode, argument.carrier));
      const arrayIndexes = indexes.slice(form.leadingArguments.length);
      const elements = arrayIndexes.map((sourceIndex) =>
        input.argumentTo(sourceIndex, "value", form.elementCarrier));
      if (leading.some((entry) => entry === undefined) || elements.some((entry) => entry === undefined)) {
        return undefined;
      }
      return {
        targetReceiver: none,
        targetArguments: [
          ...leading as RustFinalizedSourceInput[],
          {
            source: { kind: "argument-array", sourceIndexes: arrayIndexes },
            elements: elements as RustFinalizedSourceInput[],
            elementCarrier: form.elementCarrier,
            mode: "value",
          },
        ],
      };
    }
    case "receiver-value-array": {
      const receiver = input.receiver(form.receiverMode);
      const leading = form.leadingArguments.map((argument, sourceIndex) =>
        input.argumentTo(sourceIndex, argument.mode, argument.carrier));
      const arrayIndexes = indexes.slice(form.leadingArguments.length);
      const elements = arrayIndexes.map((sourceIndex) =>
        input.argumentTo(sourceIndex, "value", form.elementCarrier));
      if (receiver === undefined || leading.some((entry) => entry === undefined) ||
        elements.some((entry) => entry === undefined)) {
        return undefined;
      }
      return {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: [
          ...leading as RustFinalizedSourceInput[],
          {
            source: { kind: "argument-array", sourceIndexes: arrayIndexes },
            elements: elements as RustFinalizedSourceInput[],
            elementCarrier: form.elementCarrier,
            mode: "value",
          },
        ],
      };
    }
    case "receiver-tagged-array": {
      const receiver = input.receiver(form.receiverMode);
      const leading = form.leadingArguments.map((argument, sourceIndex) =>
        input.argumentTo(sourceIndex, argument.mode, argument.carrier));
      const arrayIndexes = indexes.slice(form.leadingArguments.length);
      const elements = arrayIndexes.map((sourceIndex) => {
        const sourceCarrier = input.sourceArgumentCarrier(sourceIndex);
        const exact = sourceCarrier === undefined
          ? []
          : form.alternatives.filter((candidate) =>
              rustTargetTypeRefEquals(candidate.inputCarrier, sourceCarrier));
        const convertible = sourceCarrier === undefined || exact.length > 0
          ? []
          : form.alternatives.filter((candidate) =>
              selectRustSourceValueConversion(sourceCarrier, candidate.inputCarrier) !== undefined);
        const candidates = exact.length > 0 ? exact : convertible;
        const alternative = candidates.length === 1 ? candidates[0] : undefined;
        const selectedInput = alternative === undefined
          ? undefined
          : input.argumentTo(sourceIndex, alternative.mode, alternative.inputCarrier);
        return selectedInput === undefined || alternative === undefined
          ? undefined
          : { input: selectedInput, constructorPath: alternative.constructorPath };
      });
      if (receiver === undefined || leading.some((entry) => entry === undefined) ||
        elements.some((entry) => entry === undefined)) {
        return undefined;
      }
      return {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: [
          ...leading as RustFinalizedSourceInput[],
          {
            source: { kind: "argument-tagged-array", sourceIndexes: arrayIndexes },
            elements: elements as readonly {
              readonly input: RustFinalizedSourceInput;
              readonly constructorPath: string;
            }[],
            elementCarrier: form.elementCarrier,
            mode: "value",
          },
        ],
      };
    }
  }
}

export function finalizeSourceArguments(
  operationKind: RustFinalizedOperationKind,
  carriers: readonly TargetTypeRef[],
  mapping: {
    readonly targetReceiver: RustFinalizedOperationAbi["targetReceiver"];
    readonly targetArguments: readonly RustFinalizedTargetInput[];
  },
  compileTimeSourceArgumentIndexes: readonly number[] | undefined,
): readonly RustFinalizedSourceArgument[] | undefined {
  const compileTime = new Set(compileTimeSourceArgumentIndexes ?? []);
  if (compileTime.size !== (compileTimeSourceArgumentIndexes?.length ?? 0) ||
    [...compileTime].some((index) => !Number.isInteger(index) || index < 0 || index >= carriers.length)) {
    return undefined;
  }
  const modes = new Map<number, RustArgumentMode>();
  const runtime = new Set<number>();
  const collect = (input: RustFinalizedTargetInput): boolean => {
    if (isRustFinalizedSourceInput(input) && input.source.kind === "argument") {
      const previous = modes.get(input.source.sourceIndex);
      if (previous !== undefined && previous !== input.mode) {
        return false;
      }
      modes.set(input.source.sourceIndex, input.mode);
      runtime.add(input.source.sourceIndex);
    } else if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
      for (const element of input.elements) {
        if (!collect(element)) {
          return false;
        }
      }
    } else if (isRustFinalizedTaggedArrayInput(input)) {
      for (const element of input.elements) {
        if (!collect(element.input)) {
          return false;
        }
      }
    }
    return true;
  };
  if (mapping.targetReceiver.kind === "input" && !collect(mapping.targetReceiver.input)) {
    return undefined;
  }
  if (!mapping.targetArguments.every(collect)) {
    return undefined;
  }
  if ([...runtime].some((index) => compileTime.has(index)) ||
    carriers.some((_carrier, index) => !runtime.has(index) && !compileTime.has(index))) {
    return undefined;
  }
  return carriers.map((carrier, sourceIndex) => ({
    sourceIndex,
    carrier,
    mode: modes.get(sourceIndex) ?? "value",
    role: compileTime.has(sourceIndex)
      ? "compile-time"
      : (operationKind === "indexer" || operationKind === "index-set") && sourceIndex === 0
        ? "index"
        : "parameter",
    disposition: compileTime.has(sourceIndex) ? "compile-time" : "runtime",
  }));
}
