import type {
  RustArgumentMode,
  RustProviderConstantArgument,
  RustProviderOperationForm,
} from "./keys.js";
import type { RustFinalizedOperationKind } from "./finalized-operation-abi.js";
import { rustValueConversionContract } from "./value-conversions.js";
import { isRustBinaryOperator, rustBinaryOperatorTraitPath } from "../../common/rust-syntax.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import { isRustTargetTypeRef } from "../../policy/equality.js";

const rustIdentifierPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u;
const rustPathPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:::(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*$/u;
const modes = new Set<RustArgumentMode>(["value", "ref", "mut-ref"]);

export function rustProviderOperationFormContractViolation(
  operationKind: RustFinalizedOperationKind,
  form: RustProviderOperationForm,
  sourceArgumentCount: number,
  runtimeSourceIndexes: readonly number[] = Array.from({ length: sourceArgumentCount }, (_, index) => index),
): string | undefined {
  if (!Number.isSafeInteger(sourceArgumentCount) || sourceArgumentCount < 0 || !isRecord(form) ||
    !isDenseDataArray(runtimeSourceIndexes) || new Set(runtimeSourceIndexes).size !== runtimeSourceIndexes.length ||
    runtimeSourceIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= sourceArgumentCount)) {
    return "operation form input is not closed metadata";
  }
  const validateModes = (values: readonly RustArgumentMode[] | undefined): string | undefined => {
    if (values === undefined) {
      return undefined;
    }
    if (!isDenseDataArray(values) || values.length !== runtimeSourceIndexes.length || values.some((mode) => !modes.has(mode))) {
      return "argument modes must exactly cover all source arguments";
    }
    return undefined;
  };
  const validateArguments = (
    value: Extract<RustProviderOperationForm, { readonly form: "call" | "free-call" | "receiver-method" }>,
  ): string | undefined => {
    const modeViolation = validateModes(value.argModes);
    if (modeViolation !== undefined) {
      return modeViolation;
    }
    if (value.argConversions !== undefined &&
      (!isDenseDataArray(value.argConversions) || value.argConversions.length !== runtimeSourceIndexes.length ||
        value.argConversions.some((conversion) => conversion !== undefined && rustValueConversionContract(conversion) === undefined))) {
      return "argument conversions must exactly cover all source arguments with known contracts";
    }
    if (value.argOrder !== undefined && !isPermutation(value.argOrder, runtimeSourceIndexes)) {
      return "argument order must be an exact source-argument permutation";
    }
    if ("trailingArguments" in value && value.trailingArguments !== undefined &&
      (!isDenseDataArray(value.trailingArguments) || value.trailingArguments.some((argument) => !constantIsValid(argument)))) {
      return "trailing arguments must be closed constants";
    }
    if ("chain" in value && value.chain !== undefined &&
      (!isDenseDataArray(value.chain) || value.chain.some((step) =>
        !hasExactKeys(step, ["kind", "name"], ["kind", "name"]) || step.kind !== "method" ||
        typeof step.name !== "string" || !rustIdentifierPattern.test(step.name)))) {
      return "operation chains must contain only concrete zero-argument method steps";
    }
    return undefined;
  };

  switch (form.form) {
    case "marker":
      return hasExactKeys(form, ["form"], ["form"]) && runtimeSourceIndexes.length === 0 ? undefined : "marker form has invalid fields or arguments";
    case "path":
      return hasExactKeys(form, ["form", "path"], ["form", "path"]) && typeof form.path === "string" && rustPathPattern.test(form.path) && runtimeSourceIndexes.length === 0
        ? undefined
        : "path form must be a zero-argument closed Rust path";
    case "call-str-slice":
      return hasExactKeys(form, ["form", "path"], ["form", "path"]) && typeof form.path === "string" && rustPathPattern.test(form.path)
        ? undefined
        : "slice-call form must contain one closed Rust path";
    case "free-call-str-slice":
      return hasExactKeys(form, ["form", "path", "receiverMode"], ["form", "path", "receiverMode"]) &&
          typeof form.path === "string" && rustPathPattern.test(form.path) && modes.has(form.receiverMode)
        ? undefined
        : "receiver slice-call form must contain one closed Rust path and receiver mode";
    case "call-value-slice":
    case "call-value-array":
      return hasExactKeys(
        form,
        ["form", "path", "leadingArguments", "elementCarrier"],
        ["form", "path", "leadingArguments", "elementCarrier"],
      ) && typeof form.path === "string" && rustPathPattern.test(form.path) &&
        isDenseDataArray(form.leadingArguments) &&
        form.leadingArguments.every((argument) =>
          hasExactKeys(argument, ["carrier", "mode"], ["carrier", "mode"]) &&
          isRustTargetTypeRef(argument.carrier) && modes.has(argument.mode)) &&
        isRustTargetTypeRef(form.elementCarrier) &&
        runtimeSourceIndexes.length === sourceArgumentCount &&
        runtimeSourceIndexes.length >= form.leadingArguments.length
        ? undefined
        : "value collection call must contain one path, closed leading arguments, a closed element carrier, and only runtime source arguments";
    case "receiver-value-array":
      return hasExactKeys(
        form,
        ["form", "name", "receiverMode", "leadingArguments", "elementCarrier"],
        ["form", "name", "receiverMode", "leadingArguments", "elementCarrier"],
      ) && typeof form.name === "string" && rustIdentifierPattern.test(form.name) &&
        modes.has(form.receiverMode) && isDenseDataArray(form.leadingArguments) &&
        form.leadingArguments.every((argument) =>
          hasExactKeys(argument, ["carrier", "mode"], ["carrier", "mode"]) &&
          isRustTargetTypeRef(argument.carrier) && modes.has(argument.mode)) &&
        isRustTargetTypeRef(form.elementCarrier) &&
        runtimeSourceIndexes.length === sourceArgumentCount &&
        runtimeSourceIndexes.length >= form.leadingArguments.length
        ? undefined
        : "receiver value-array call must contain one method, receiver mode, closed leading arguments, a closed element carrier, and only runtime source arguments";
    case "method":
    case "arg-method":
      return hasExactKeys(form, ["form", "name"], ["form", "name"]) && typeof form.name === "string" && rustIdentifierPattern.test(form.name)
        ? undefined
        : "method form must contain one Rust identifier";
    case "field":
      return hasExactKeys(form, ["form", "name"], ["form", "name"]) && typeof form.name === "string" && rustIdentifierPattern.test(form.name) && runtimeSourceIndexes.length === 0
        ? undefined
        : "field form must contain one Rust identifier and no source arguments";
    case "arg-receiver-method": {
      if (!hasExactKeys(form, ["form", "name", "argModes"], ["form", "name"]) ||
        typeof form.name !== "string" || !rustIdentifierPattern.test(form.name)) {
        return "argument-receiver method form is malformed";
      }
      return validateModes(form.argModes);
    }
    case "index":
      return hasExactKeys(form, ["form", "indexConversion"], ["form"]) &&
        (form.indexConversion === undefined || rustValueConversionContract(form.indexConversion) !== undefined) &&
        ((operationKind === "indexer" && runtimeSourceIndexes.length === 1) ||
          (operationKind === "index-set" && runtimeSourceIndexes.length === 2))
        ? undefined
        : "index form does not match its selected operation kind or conversion contract";
    case "binary-operator": {
      const expectedTrait = isRustBinaryOperator(form.operator)
        ? rustBinaryOperatorTraitPath(form.operator)
        : undefined;
      return hasExactKeys(form, ["form", "operator", "trait"], ["form", "operator", "trait"]) &&
        typeof form.trait === "string" && expectedTrait !== undefined && form.trait === expectedTrait && runtimeSourceIndexes.length === 2
        ? undefined
        : "binary operator form must name its exact std trait and two source arguments";
    }
    case "call":
      if (!hasExactKeys(form, ["form", "path", "argModes", "argConversions", "argOrder", "trailingArguments", "chain"], ["form", "path"]) ||
        typeof form.path !== "string" || !rustPathPattern.test(form.path)) {
        return "call form is malformed";
      }
      return validateArguments(form);
    case "free-call":
      if (!hasExactKeys(form, ["form", "path", "receiverMode", "argModes", "argConversions", "trailingArguments", "argOrder"], ["form", "path", "receiverMode"]) ||
        typeof form.path !== "string" || !rustPathPattern.test(form.path) || !modes.has(form.receiverMode)) {
        return "free-call form is malformed";
      }
      return validateArguments(form);
    case "receiver-method":
      if (!hasExactKeys(form, ["form", "name", "argModes", "argConversions", "argOrder", "chain", "mutatesReceiver"], ["form", "name"]) ||
        typeof form.name !== "string" || !rustIdentifierPattern.test(form.name) ||
        (form.mutatesReceiver !== undefined && typeof form.mutatesReceiver !== "boolean")) {
        return "receiver-method form is malformed";
      }
      return validateArguments(form);
    default:
      return `unsupported operation form '${String((form as { readonly form?: unknown }).form)}'`;
  }
}

function isPermutation(values: readonly number[], expected: readonly number[]): boolean {
  const expectedSet = new Set(expected);
  return isDenseDataArray(values) && isDenseDataArray(expected) && values.length === expected.length &&
    values.every((value) => expectedSet.has(value)) && new Set(values).size === expected.length;
}

function constantIsValid(value: RustProviderConstantArgument): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "integer") {
    return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) && Number.isSafeInteger(value.value);
  }
  if (value.kind === "string") {
    return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) && typeof value.value === "string";
  }
  if (value.kind === "boolean") {
    return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) && typeof value.value === "boolean";
  }
  return value.kind === "none" && hasExactKeys(value, ["kind"], ["kind"]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, allowed: readonly string[], required: readonly string[]): boolean {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
