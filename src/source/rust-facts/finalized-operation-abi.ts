import type { TargetTypeRef } from "../../policy/types.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../../policy/equality.js";
import type {
  RustArgumentMode,
  RustProviderConstantArgument,
  RustProviderOperationForm,
  RustValueConversion,
} from "./keys.js";
import {
  rustFutureTargetType,
  rustSliceRefTargetType,
  rustStringTargetType,
} from "../rust-target-types.js";
import {
  rustValueConversionContract,
  selectRustSourceValueConversion,
} from "./value-conversions.js";
import { closedMetadataEquals, isClosedMetadata, isDenseDataArray } from "../../common/closed-metadata.js";
import { rustProviderOperationFormContractViolation } from "./operation-form-contract.js";

export type RustFinalizedOperationKind =
  | "method"
  | "constructor"
  | "property"
  | "indexer"
  | "property-set"
  | "index-set";

export type RustFinalizedSourceArgumentRole = "parameter" | "index" | "compile-time";

export interface RustFinalizedSourceArgument {
  readonly sourceIndex: number;
  readonly carrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly role: RustFinalizedSourceArgumentRole;
  readonly disposition: "runtime" | "compile-time";
}

export type RustFinalizedValueConversion =
  | {
      readonly kind: "identity";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly fallible: false;
    }
  | {
      readonly kind: "semantic";
      readonly conversion: RustValueConversion;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly fallible: boolean;
    };

export interface RustFinalizedSourceInput {
  readonly source: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly sourceIndex: number };
  readonly sourceCarrier: TargetTypeRef;
  readonly conversion: RustFinalizedValueConversion;
  readonly mode: RustArgumentMode;
  readonly parameterCarrier: TargetTypeRef;
}

export interface RustFinalizedSliceInput {
  readonly source: { readonly kind: "argument-slice"; readonly sourceIndexes: readonly number[] };
  readonly elements: readonly RustFinalizedSourceInput[];
  readonly elementCarrier: TargetTypeRef;
  readonly mode: "ref";
  readonly parameterCarrier: TargetTypeRef;
}

export interface RustFinalizedArrayInput {
  readonly source: { readonly kind: "argument-array"; readonly sourceIndexes: readonly number[] };
  readonly elements: readonly RustFinalizedSourceInput[];
  readonly elementCarrier: TargetTypeRef;
  readonly mode: "value";
}

export interface RustFinalizedTaggedArrayInput {
  readonly source: { readonly kind: "argument-tagged-array"; readonly sourceIndexes: readonly number[] };
  readonly elements: readonly {
    readonly input: RustFinalizedSourceInput;
    readonly constructorPath: string;
  }[];
  readonly elementCarrier: TargetTypeRef;
  readonly mode: "value";
}

export interface RustFinalizedConstantInput {
  readonly source: { readonly kind: "constant"; readonly value: RustProviderConstantArgument };
}

export type RustFinalizedTargetInput = RustFinalizedSourceInput | RustFinalizedSliceInput | RustFinalizedArrayInput | RustFinalizedTaggedArrayInput | RustFinalizedConstantInput;

export type RustFinalizedOperationResult =
  | {
      readonly kind: "sync";
      readonly rawCarrier: TargetTypeRef;
      readonly conversion: RustFinalizedValueConversion;
      readonly carrier: TargetTypeRef;
    }
  | {
      readonly kind: "async";
      readonly futureCarrier: TargetTypeRef;
      readonly awaitedRawCarrier: TargetTypeRef;
      readonly awaitedConversion: RustFinalizedValueConversion;
      readonly awaitedCarrier: TargetTypeRef;
    };

export interface RustFinalizedOperationAbi {
  readonly operationKind: RustFinalizedOperationKind;
  readonly target: RustProviderOperationForm;
  readonly sourceReceiver: { readonly kind: "none" } | { readonly kind: "receiver"; readonly carrier: TargetTypeRef };
  readonly sourceArguments: readonly RustFinalizedSourceArgument[];
  readonly targetReceiver: { readonly kind: "none" } | { readonly kind: "input"; readonly input: RustFinalizedSourceInput };
  readonly targetArguments: readonly RustFinalizedTargetInput[];
  readonly result: RustFinalizedOperationResult;
  readonly effects: {
    readonly invocation: "infallible" | "fallible";
    readonly awaiting: "not-applicable" | "infallible" | "fallible";
    readonly safety: "safe" | "requires-unsafe";
  };
}

export type RustFinalizedOperationAbiFor<
  OperationKind extends RustFinalizedOperationKind,
> = Omit<RustFinalizedOperationAbi, "operationKind"> & {
  readonly operationKind: OperationKind;
};

export interface FinalizeRustProviderOperationAbiOptions<
  OperationKind extends RustFinalizedOperationKind = RustFinalizedOperationKind,
> {
  readonly operationKind: OperationKind;
  readonly form: RustProviderOperationForm;
  readonly sourceReceiverCarrier?: TargetTypeRef;
  readonly sourceArgumentCarriers: readonly TargetTypeRef[];
  readonly declaredSourceArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly compileTimeSourceArgumentIndexes?: readonly number[];
  readonly resultCarrier: TargetTypeRef;
  readonly resultConversion?: RustValueConversion;
  readonly isAsync: boolean;
  readonly isFallible: boolean;
  readonly isUnsafe?: boolean;
}

export function finalizeRustProviderOperationAbi<OperationKind extends RustFinalizedOperationKind>(
  options: FinalizeRustProviderOperationAbiOptions<OperationKind>,
): RustFinalizedOperationAbiFor<OperationKind> | undefined {
  if (!operationKinds.has(options.operationKind) || !isRustTargetTypeRef(options.resultCarrier) ||
    (options.sourceReceiverCarrier !== undefined && !isRustTargetTypeRef(options.sourceReceiverCarrier)) ||
    !isDenseDataArray(options.sourceArgumentCarriers) ||
    options.sourceArgumentCarriers.some((carrier) => !isRustTargetTypeRef(carrier)) ||
    (options.declaredSourceArgumentCarriers !== undefined &&
      (!isDenseDataArray(options.declaredSourceArgumentCarriers) ||
        options.declaredSourceArgumentCarriers.some((carrier) => carrier !== undefined && !isRustTargetTypeRef(carrier)))) ||
    (options.compileTimeSourceArgumentIndexes !== undefined &&
      (!isDenseDataArray(options.compileTimeSourceArgumentIndexes) ||
        new Set(options.compileTimeSourceArgumentIndexes).size !== options.compileTimeSourceArgumentIndexes.length ||
        options.compileTimeSourceArgumentIndexes.some((index) =>
          !Number.isSafeInteger(index) || index < 0 || index >= options.sourceArgumentCarriers.length))) ||
    typeof options.isAsync !== "boolean" || typeof options.isFallible !== "boolean" ||
    (options.isUnsafe !== undefined && typeof options.isUnsafe !== "boolean")) {
    return undefined;
  }
  const compileTimeIndexes = new Set(options.compileTimeSourceArgumentIndexes ?? []);
  const runtimeSourceIndexes = options.sourceArgumentCarriers
    .map((_carrier, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  if (rustProviderOperationFormContractViolation(
    options.operationKind,
    options.form,
    options.sourceArgumentCarriers.length,
    runtimeSourceIndexes,
  ) !== undefined) {
    return undefined;
  }
  if (!declaredCarriersMatch(
    options.sourceArgumentCarriers,
    runtimeSourceIndexes,
    options.declaredSourceArgumentCarriers,
  )) {
    return undefined;
  }
  const input = createInputFactory(options.sourceReceiverCarrier, options.sourceArgumentCarriers);
  const mapping = finalizeTargetInputs(
    options.operationKind,
    options.form,
    input,
    options.sourceArgumentCarriers.length,
  );
  if (mapping === undefined) {
    return undefined;
  }
  const sourceArguments = finalizeSourceArguments(
    options.operationKind,
    options.sourceArgumentCarriers,
    mapping,
    options.compileTimeSourceArgumentIndexes,
  );
  if (sourceArguments === undefined) {
    return undefined;
  }
  const resultConversion = finalizeValueConversion(options.resultConversion, undefined, options.resultCarrier);
  if (resultConversion === undefined) {
    return undefined;
  }
  const result: RustFinalizedOperationResult = options.isAsync
    ? {
        kind: "async",
        futureCarrier: rustFutureTargetType(options.resultCarrier),
        awaitedRawCarrier: resultConversion.sourceCarrier,
        awaitedConversion: resultConversion,
        awaitedCarrier: options.resultCarrier,
      }
    : {
        kind: "sync",
        rawCarrier: resultConversion.sourceCarrier,
        conversion: resultConversion,
        carrier: options.resultCarrier,
      };
  const abi: RustFinalizedOperationAbiFor<OperationKind> = {
    operationKind: options.operationKind,
    target: options.form,
    sourceReceiver: options.sourceReceiverCarrier === undefined
      ? { kind: "none" }
      : { kind: "receiver", carrier: options.sourceReceiverCarrier },
    sourceArguments,
    targetReceiver: mapping.targetReceiver,
    targetArguments: mapping.targetArguments,
    result,
    effects: {
      invocation: options.isFallible && !options.isAsync ? "fallible" : "infallible",
      awaiting: options.isAsync
        ? options.isFallible ? "fallible" : "infallible"
        : "not-applicable",
      safety: options.isUnsafe ? "requires-unsafe" : "safe",
    },
  };
  return validateRustFinalizedOperationAbi(abi) ? abi : undefined;
}

export function validateRustFinalizedOperationAbi(candidate: unknown): candidate is RustFinalizedOperationAbi {
  if (!isClosedMetadata(candidate) || !isRustFinalizedOperationAbiShape(candidate)) {
    return false;
  }
  const abi = candidate;
  if (rustProviderOperationFormContractViolation(
    abi.operationKind,
    abi.target,
    abi.sourceArguments.length,
    abi.sourceArguments.filter((argument) => argument.disposition === "runtime").map((argument) => argument.sourceIndex),
  ) !== undefined ||
    (abi.effects.invocation !== "infallible" && abi.effects.invocation !== "fallible") ||
    (abi.effects.awaiting !== "not-applicable" && abi.effects.awaiting !== "infallible" && abi.effects.awaiting !== "fallible") ||
    (abi.effects.safety !== "safe" && abi.effects.safety !== "requires-unsafe")) {
    return false;
  }
  if (abi.sourceArguments.some((argument, index) => {
    const expectedRole: RustFinalizedSourceArgumentRole = argument.disposition === "compile-time"
      ? "compile-time"
      : (abi.operationKind === "indexer" || abi.operationKind === "index-set") && index === 0
        ? "index"
        : "parameter";
    return argument.sourceIndex !== index ||
      (argument.mode !== "value" && argument.mode !== "ref" && argument.mode !== "mut-ref") ||
      (argument.disposition !== "runtime" && argument.disposition !== "compile-time") ||
      argument.role !== expectedRole;
  })) {
    return false;
  }
  const runtimeIndexes = new Set<number>();
  const validateSourceInput = (input: RustFinalizedSourceInput): boolean => {
    if (!finalizedConversionIsValid(input.conversion) ||
      !rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.sourceCarrier) ||
      !rustTargetTypeRefEquals(input.parameterCarrier, carrierAfterMode(input.conversion.targetCarrier, input.mode))) {
      return false;
    }
    if (input.source.kind === "argument") {
      const argument = abi.sourceArguments[input.source.sourceIndex];
      if (argument === undefined || argument.disposition !== "runtime" ||
        argument.role === "compile-time" || argument.mode !== input.mode ||
        !rustTargetTypeRefEquals(argument.carrier, input.sourceCarrier)) {
        return false;
      }
      runtimeIndexes.add(input.source.sourceIndex);
    } else if (abi.sourceReceiver.kind !== "receiver" ||
      !rustTargetTypeRefEquals(abi.sourceReceiver.carrier, input.sourceCarrier)) {
      return false;
    }
    return true;
  };
  if (abi.targetReceiver.kind === "input" && !validateSourceInput(abi.targetReceiver.input)) {
    return false;
  }
  for (const input of abi.targetArguments) {
    if (isRustFinalizedConstantInput(input)) {
      continue;
    }
    if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
      if (input.elements.length !== input.source.sourceIndexes.length ||
        !input.elements.every((element, index) =>
          element.source.kind === "argument" &&
          element.source.sourceIndex === input.source.sourceIndexes[index] &&
          validateSourceInput(element))) {
        return false;
      }
      if (input.elements.some((element) =>
        !rustTargetTypeRefEquals(element.parameterCarrier, input.elementCarrier)) ||
        (isRustFinalizedSliceInput(input) &&
          !rustTargetTypeRefEquals(input.parameterCarrier, rustSliceRefTargetType(input.elementCarrier)))) {
        return false;
      }
      continue;
    }
    if (isRustFinalizedTaggedArrayInput(input)) {
      if (input.elements.length !== input.source.sourceIndexes.length ||
        !input.elements.every((element, index) =>
          element.input.source.kind === "argument" &&
          element.input.source.sourceIndex === input.source.sourceIndexes[index] &&
          typeof element.constructorPath === "string" &&
          validateSourceInput(element.input))) {
        return false;
      }
      continue;
    }
    if (!validateSourceInput(input)) {
      return false;
    }
  }
  if (abi.sourceArguments.some((argument) =>
    argument.disposition === "runtime" && !runtimeIndexes.has(argument.sourceIndex))) {
    return false;
  }
  const sourceReceiverCarrier = abi.sourceReceiver.kind === "receiver"
    ? abi.sourceReceiver.carrier
    : undefined;
  const expectedMapping = finalizeTargetInputs(
    abi.operationKind,
    abi.target,
    createInputFactory(sourceReceiverCarrier, abi.sourceArguments.map((argument) => argument.carrier)),
    abi.sourceArguments.length,
  );
  if (expectedMapping === undefined ||
    !closedMetadataEquals(expectedMapping.targetReceiver, abi.targetReceiver) ||
    !closedMetadataEquals(expectedMapping.targetArguments, abi.targetArguments)) {
    return false;
  }
  if (abi.result.kind === "sync") {
    return abi.effects.awaiting === "not-applicable" &&
      finalizedConversionIsValid(abi.result.conversion) &&
      rustTargetTypeRefEquals(abi.result.rawCarrier, abi.result.conversion.sourceCarrier) &&
      rustTargetTypeRefEquals(abi.result.carrier, abi.result.conversion.targetCarrier);
  }
  return abi.effects.invocation === "infallible" &&
    (abi.effects.awaiting === "infallible" || abi.effects.awaiting === "fallible") &&
    finalizedConversionIsValid(abi.result.awaitedConversion) &&
    rustTargetTypeRefEquals(abi.result.awaitedRawCarrier, abi.result.awaitedConversion.sourceCarrier) &&
    rustTargetTypeRefEquals(abi.result.awaitedCarrier, abi.result.awaitedConversion.targetCarrier) &&
    rustTargetTypeRefEquals(abi.result.futureCarrier, rustFutureTargetType(abi.result.awaitedCarrier));
}

function isRustFinalizedOperationAbiShape(value: unknown): value is RustFinalizedOperationAbi {
  if (!isRecord(value) || !hasExactKeys(value, [
    "operationKind",
    "target",
    "sourceReceiver",
    "sourceArguments",
    "targetReceiver",
    "targetArguments",
    "result",
    "effects",
  ]) || !operationKinds.has(value.operationKind) || !isRecord(value.target) ||
    !Array.isArray(value.sourceArguments) || !Array.isArray(value.targetArguments)) {
    return false;
  }
  if (!isSourceReceiver(value.sourceReceiver) ||
    !value.sourceArguments.every(isSourceArgument) ||
    !isTargetReceiver(value.targetReceiver) ||
    !value.targetArguments.every(isTargetInput) ||
    !isOperationResult(value.result) || !isEffects(value.effects)) {
    return false;
  }
  return true;
}

const operationKinds = new Set<unknown>(["method", "constructor", "property", "indexer", "property-set", "index-set"]);
const argumentModes = new Set<unknown>(["value", "ref", "mut-ref"]);
const argumentRoles = new Set<unknown>(["parameter", "index", "compile-time"]);
const dispositions = new Set<unknown>(["runtime", "compile-time"]);

function isSourceReceiver(value: unknown): value is RustFinalizedOperationAbi["sourceReceiver"] {
  return isRecord(value) && (value.kind === "none"
    ? hasExactKeys(value, ["kind"])
    : value.kind === "receiver" && hasExactKeys(value, ["kind", "carrier"]) && isRustTargetTypeRef(value.carrier));
}

function isSourceArgument(value: unknown): value is RustFinalizedSourceArgument {
  return isRecord(value) && hasExactKeys(value, ["sourceIndex", "carrier", "mode", "role", "disposition"]) &&
    Number.isSafeInteger(value.sourceIndex) && (value.sourceIndex as number) >= 0 &&
    isRustTargetTypeRef(value.carrier) && argumentModes.has(value.mode) && argumentRoles.has(value.role) &&
    dispositions.has(value.disposition);
}

function isTargetReceiver(value: unknown): value is RustFinalizedOperationAbi["targetReceiver"] {
  return isRecord(value) && (value.kind === "none"
    ? hasExactKeys(value, ["kind"])
    : value.kind === "input" && hasExactKeys(value, ["kind", "input"]) && isSourceInput(value.input));
}

function isTargetInput(value: unknown): value is RustFinalizedTargetInput {
  if (!isRecord(value) || !isRecord(value.source)) {
    return false;
  }
  if (value.source.kind === "receiver" || value.source.kind === "argument") {
    return isSourceInput(value);
  }
  if (value.source.kind === "argument-slice") {
    return hasExactKeys(value, ["source", "elements", "elementCarrier", "mode", "parameterCarrier"]) &&
      hasExactKeys(value.source, ["kind", "sourceIndexes"]) && Array.isArray(value.source.sourceIndexes) &&
      value.source.sourceIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      Array.isArray(value.elements) && value.elements.every(isSourceInput) &&
      isRustTargetTypeRef(value.elementCarrier) && value.mode === "ref" && isRustTargetTypeRef(value.parameterCarrier);
  }
  if (value.source.kind === "argument-array") {
    return hasExactKeys(value, ["source", "elements", "elementCarrier", "mode"]) &&
      hasExactKeys(value.source, ["kind", "sourceIndexes"]) && Array.isArray(value.source.sourceIndexes) &&
      value.source.sourceIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      Array.isArray(value.elements) && value.elements.every(isSourceInput) &&
      isRustTargetTypeRef(value.elementCarrier) && value.mode === "value";
  }
  if (value.source.kind === "argument-tagged-array") {
    return hasExactKeys(value, ["source", "elements", "elementCarrier", "mode"]) &&
      hasExactKeys(value.source, ["kind", "sourceIndexes"]) && Array.isArray(value.source.sourceIndexes) &&
      value.source.sourceIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      Array.isArray(value.elements) && value.elements.every((element) =>
        isRecord(element) && hasExactKeys(element, ["input", "constructorPath"]) &&
        isSourceInput(element.input) && typeof element.constructorPath === "string") &&
      isRustTargetTypeRef(value.elementCarrier) && value.mode === "value";
  }
  return value.source.kind === "constant" && hasExactKeys(value, ["source"]) &&
    hasExactKeys(value.source, ["kind", "value"]) && isProviderConstant(value.source.value);
}

function isSourceInput(value: unknown): value is RustFinalizedSourceInput {
  if (!isRecord(value) || !hasExactKeys(value, ["source", "sourceCarrier", "conversion", "mode", "parameterCarrier"]) ||
    !isRecord(value.source) || !isRustTargetTypeRef(value.sourceCarrier) || !isFinalizedConversion(value.conversion) ||
    !argumentModes.has(value.mode) || !isRustTargetTypeRef(value.parameterCarrier)) {
    return false;
  }
  return value.source.kind === "receiver"
    ? hasExactKeys(value.source, ["kind"])
    : value.source.kind === "argument" && hasExactKeys(value.source, ["kind", "sourceIndex"]) &&
      Number.isSafeInteger(value.source.sourceIndex) && (value.source.sourceIndex as number) >= 0;
}

function isFinalizedConversion(value: unknown): value is RustFinalizedValueConversion {
  if (!isRecord(value) || !isRustTargetTypeRef(value.sourceCarrier) || !isRustTargetTypeRef(value.targetCarrier)) {
    return false;
  }
  if (value.kind === "identity") {
    return hasExactKeys(value, ["kind", "sourceCarrier", "targetCarrier", "fallible"]) && value.fallible === false;
  }
  return value.kind === "semantic" && hasExactKeys(value, [
    "kind", "conversion", "sourceCarrier", "targetCarrier", "fallible",
  ]) && isRecord(value.conversion) &&
    ((value.conversion.kind === "semantic-conversion" &&
      hasExactKeys(value.conversion, ["kind", "id"]) && typeof value.conversion.id === "string") ||
    (value.conversion.kind === "numeric-promotion" &&
      hasExactKeys(value.conversion, ["kind", "source", "target"]) &&
      typeof value.conversion.source === "string" && typeof value.conversion.target === "string") ||
    (value.conversion.kind === "raw-pointer-mut-to-const" &&
      hasExactKeys(value.conversion, ["kind", "pointee"]) &&
      isRustTargetTypeRef(value.conversion.pointee))) &&
    rustValueConversionContract(value.conversion as RustValueConversion) !== undefined &&
    typeof value.fallible === "boolean";
}

function isProviderConstant(value: unknown): value is RustProviderConstantArgument {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.kind) {
    case "integer":
      return hasExactKeys(value, ["kind", "value"]) && Number.isSafeInteger(value.value);
    case "string":
      return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "string";
    case "boolean":
      return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "boolean";
    case "none":
      return hasExactKeys(value, ["kind"]);
    default:
      return false;
  }
}

function isOperationResult(value: unknown): value is RustFinalizedOperationResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "sync") {
    return hasExactKeys(value, ["kind", "rawCarrier", "conversion", "carrier"]) &&
      isRustTargetTypeRef(value.rawCarrier) && isFinalizedConversion(value.conversion) &&
      isRustTargetTypeRef(value.carrier);
  }
  return value.kind === "async" && hasExactKeys(value, [
    "kind", "futureCarrier", "awaitedRawCarrier", "awaitedConversion", "awaitedCarrier",
  ]) && isRustTargetTypeRef(value.futureCarrier) && isRustTargetTypeRef(value.awaitedRawCarrier) &&
    isFinalizedConversion(value.awaitedConversion) && isRustTargetTypeRef(value.awaitedCarrier);
}

function isEffects(value: unknown): value is RustFinalizedOperationAbi["effects"] {
  return isRecord(value) && hasExactKeys(value, ["invocation", "awaiting", "safety"]) &&
    (value.invocation === "infallible" || value.invocation === "fallible") &&
    (value.awaiting === "not-applicable" || value.awaiting === "infallible" || value.awaiting === "fallible") &&
    (value.safety === "safe" || value.safety === "requires-unsafe");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function createInputFactory(
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

function finalizeTargetInputs(
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
    case "call": {
      const args = mappedArguments(form.argOrder, form.argModes, form.argConversions);
      return args === undefined ? undefined : {
        targetReceiver: none,
        targetArguments: [...args, ...constants(form.trailingArguments)],
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
      const receiver = input.receiver("ref");
      return receiver === undefined || sourceArgumentCount !== 0 ? undefined : {
        targetReceiver: { kind: "input", input: receiver },
        targetArguments: [],
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
        input.argument(index, form.argModes?.[targetIndex + 1] ?? "value"));
      return receiver === undefined || sourceReceiver === undefined || rest.some((entry) => entry === undefined)
        ? undefined
        : {
            targetReceiver: { kind: "input", input: receiver },
            targetArguments: [sourceReceiver, ...rest as RustFinalizedSourceInput[]],
          };
    }
    case "binary-operator": {
      const args = mappedArguments(undefined, undefined, undefined);
      return args?.length === 2 ? { targetReceiver: none, targetArguments: args } : undefined;
    }
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
        kind: "pointer",
        pointee: stringCarrier,
        mutability: "const",
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
        kind: "pointer",
        pointee: stringCarrier,
        mutability: "const",
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

function finalizeSourceArguments(
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

function sourceInput(
  source: RustFinalizedSourceInput["source"],
  sourceCarrier: TargetTypeRef,
  mode: RustArgumentMode,
  conversion: RustValueConversion | undefined,
): RustFinalizedSourceInput | undefined {
  const finalized = finalizeValueConversion(conversion, sourceCarrier, undefined);
  const parameterCarrier = finalized === undefined ? undefined : carrierAfterMode(finalized.targetCarrier, mode);
  return finalized === undefined || parameterCarrier === undefined ? undefined : {
    source,
    sourceCarrier,
    conversion: finalized,
    mode,
    parameterCarrier,
  };
}

function finalizeValueConversion(
  conversion: RustValueConversion | undefined,
  sourceCarrier: TargetTypeRef | undefined,
  targetCarrier: TargetTypeRef | undefined,
): RustFinalizedValueConversion | undefined {
  if (conversion === undefined) {
    const carrier = sourceCarrier ?? targetCarrier;
    return carrier === undefined || (sourceCarrier !== undefined && targetCarrier !== undefined &&
      !rustTargetTypeRefEquals(sourceCarrier, targetCarrier))
      ? undefined
      : {
          kind: "identity",
          sourceCarrier: carrier,
          targetCarrier: carrier,
          fallible: false,
        };
  }
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined ||
    (sourceCarrier !== undefined && !rustTargetTypeRefEquals(sourceCarrier, contract.source)) ||
    (targetCarrier !== undefined && !rustTargetTypeRefEquals(targetCarrier, contract.target))) {
    return undefined;
  }
  return {
    kind: "semantic",
    conversion,
    sourceCarrier: contract.source,
    targetCarrier: contract.target,
    fallible: contract.fallible,
  };
}

function finalizedConversionIsValid(conversion: RustFinalizedValueConversion): boolean {
  if (conversion.kind === "identity") {
    return conversion.fallible === false && rustTargetTypeRefEquals(conversion.sourceCarrier, conversion.targetCarrier);
  }
  const contract = rustValueConversionContract(conversion.conversion);
  return contract !== undefined &&
    rustTargetTypeRefEquals(conversion.sourceCarrier, contract.source) &&
    rustTargetTypeRefEquals(conversion.targetCarrier, contract.target) &&
    conversion.fallible === contract.fallible;
}

function carrierAfterMode(carrier: TargetTypeRef, mode: RustArgumentMode): TargetTypeRef | undefined {
  if (mode === "value") {
    return carrier;
  }
  if (carrier.kind === "pointer") {
    if (mode === "mut-ref" && carrier.mutability !== "mut") {
      return undefined;
    }
    return carrier;
  }
  return {
    kind: "pointer",
    pointee: carrier,
    mutability: mode === "mut-ref" ? "mut" : "const",
  };
}

function declaredCarriersMatch(
  source: readonly TargetTypeRef[],
  runtimeSourceIndexes: readonly number[],
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
): boolean {
  return declared === undefined || (isDenseDataArray(source) && isDenseDataArray(runtimeSourceIndexes) &&
    isDenseDataArray(declared) && runtimeSourceIndexes.length === declared.length &&
    declared.every((carrier, index) => carrier === undefined ||
      rustTargetTypeRefEquals(source[runtimeSourceIndexes[index]!], carrier)));
}
