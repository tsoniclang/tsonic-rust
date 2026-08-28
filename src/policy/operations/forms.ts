import type {
  RustArgumentMode,
  RustFinalizedOperationKind,
  RustProviderConstantArgument,
  RustProviderOperationForm,
} from "../../target-model/operations/model.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { isRustBinaryOperator, rustBinaryOperatorTraitPath } from "../../target-model/syntax/tokens.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import {
  isRustTargetGenericArgument,
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../../target-model/types/equality.js";

const rustIdentifierPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u;
const rustPathPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:::(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*$/u;
const modes = new Set<RustArgumentMode>(["value", "ref", "mut-ref"]);

export function rustProviderOperationFormAcceptsTargetGenericArguments(
  form: RustProviderOperationForm,
): boolean {
  return form.form === "call" || form.form === "free-call" || form.form === "method" ||
    form.form === "source-module-construction" ||
    form.form === "receiver-method" || form.form === "arg-method" ||
    form.form === "arg-receiver-method" || form.form === "trait-call";
}

export function rustProviderOperationFormDeclaresWritableInput(
  form: RustProviderOperationForm,
): boolean {
  switch (form.form) {
    case "call":
    case "source-module-construction":
    case "arg-receiver-method":
    case "arg-structural-method":
      return form.argModes?.includes("mut-ref") === true;
    case "call-c-variadic":
      return form.fixedArgumentModes.includes("mut-ref");
    case "free-call-str-slice":
      return form.receiverMode === "mut-ref";
    case "call-value-slice":
    case "call-value-array":
      return form.leadingArguments.some((argument) => argument.mode === "mut-ref");
    case "receiver-value-array":
      return form.receiverMode === "mut-ref" ||
        form.leadingArguments.some((argument) => argument.mode === "mut-ref");
    case "receiver-tagged-array":
      return form.receiverMode === "mut-ref" ||
        form.leadingArguments.some((argument) => argument.mode === "mut-ref") ||
        form.alternatives.some((alternative) => alternative.mode === "mut-ref");
    case "free-call":
      return form.receiverMode === "mut-ref" ||
        form.argModes?.includes("mut-ref") === true;
    case "trait-call":
      return form.receiverMode === "mut-ref" ||
        form.argModes?.includes("mut-ref") === true;
    case "receiver-method":
      return form.mutatesReceiver === true ||
        form.argModes?.includes("mut-ref") === true;
    case "marker":
    case "struct-variant":
    case "expression-macro":
    case "call-str-slice":
    case "path":
    case "reference-path":
    case "static":
    case "method":
    case "arg-method":
    case "field":
    case "index":
    case "binary-operator":
    case "associated-value":
    case "trait-associated-value":
      return false;
  }
}

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
    value: Extract<RustProviderOperationForm, {
      readonly form: "call" | "source-module-construction" | "free-call" | "receiver-method";
    }>,
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
    case "reference-path":
      return hasExactKeys(form, ["form", "path", "mutable"], ["form", "path", "mutable"]) &&
          typeof form.path === "string" && rustPathPattern.test(form.path) &&
          typeof form.mutable === "boolean" && operationKind === "property" &&
          runtimeSourceIndexes.length === 0
        ? undefined
        : "reference-path form must be one zero-argument closed Rust property path";
    case "static":
      return hasExactKeys(form, ["form", "path"], ["form", "path"]) &&
          typeof form.path === "string" && rustPathPattern.test(form.path) &&
          ((operationKind === "property" && runtimeSourceIndexes.length === 0) ||
            (operationKind === "property-set" && runtimeSourceIndexes.length === 1))
        ? undefined
        : "static form must be one closed Rust path with the exact property read/write arity";
    case "call-str-slice":
      return hasExactKeys(form, ["form", "path"], ["form", "path"]) && typeof form.path === "string" && rustPathPattern.test(form.path)
        ? undefined
        : "slice-call form must contain one closed Rust path";
    case "struct-variant":
      return hasExactKeys(form, ["form", "path", "fields"], ["form", "path", "fields"]) &&
          typeof form.path === "string" && rustPathPattern.test(form.path) &&
          isDenseDataArray(form.fields) && form.fields.length === runtimeSourceIndexes.length &&
          form.fields.every((field, index) => typeof field === "string" &&
            rustIdentifierPattern.test(field) && form.fields.indexOf(field) === index)
        ? undefined
        : "struct-variant form must contain one path and one distinct Rust field for each source argument";
    case "expression-macro":
      return hasExactKeys(form, ["form", "path", "delimiter"], ["form", "path", "delimiter"]) &&
          typeof form.path === "string" && rustPathPattern.test(form.path) &&
          (form.delimiter === "parentheses" || form.delimiter === "brackets" || form.delimiter === "braces")
        ? undefined
        : "expression-macro form must contain one closed Rust path and delimiter";
    case "call-c-variadic":
      return hasExactKeys(
        form,
        ["form", "path", "fixedArgumentModes"],
        ["form", "path", "fixedArgumentModes"],
      ) && typeof form.path === "string" && rustPathPattern.test(form.path) &&
        isDenseDataArray(form.fixedArgumentModes) &&
        form.fixedArgumentModes.every((mode) => modes.has(mode)) &&
        runtimeSourceIndexes.length === sourceArgumentCount &&
        sourceArgumentCount >= form.fixedArgumentModes.length
        ? undefined
        : "C-variadic call form must contain one path, exact fixed argument modes, and only runtime source arguments";
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
    case "receiver-tagged-array":
      return hasExactKeys(
        form,
        ["form", "name", "receiverMode", "leadingArguments", "elementCarrier", "alternatives"],
        ["form", "name", "receiverMode", "leadingArguments", "elementCarrier", "alternatives"],
      ) && typeof form.name === "string" && rustIdentifierPattern.test(form.name) &&
        modes.has(form.receiverMode) && isDenseDataArray(form.leadingArguments) &&
        form.leadingArguments.every((argument) =>
          hasExactKeys(argument, ["carrier", "mode"], ["carrier", "mode"]) &&
          isRustTargetTypeRef(argument.carrier) && modes.has(argument.mode)) &&
        isRustTargetTypeRef(form.elementCarrier) && isDenseDataArray(form.alternatives) &&
        form.alternatives.length > 0 && form.alternatives.every((alternative, index) =>
          hasExactKeys(
            alternative,
            ["inputCarrier", "mode", "constructorPath"],
            ["inputCarrier", "mode", "constructorPath"],
          ) && isRustTargetTypeRef(alternative.inputCarrier) && modes.has(alternative.mode) &&
          typeof alternative.constructorPath === "string" && rustPathPattern.test(alternative.constructorPath) &&
          !form.alternatives.slice(0, index).some((previous) =>
            rustTargetTypeRefEquals(previous.inputCarrier, alternative.inputCarrier))) &&
        runtimeSourceIndexes.length === sourceArgumentCount &&
        runtimeSourceIndexes.length >= form.leadingArguments.length
        ? undefined
        : "receiver tagged-array call must contain one method, receiver mode, closed leading arguments, one closed tagged carrier, unique exact alternatives, and only runtime source arguments";
    case "method":
    case "arg-method":
      return hasExactKeys(form, ["form", "name"], ["form", "name"]) && typeof form.name === "string" && rustIdentifierPattern.test(form.name)
        ? undefined
        : "method form must contain one Rust identifier";
    case "field":
      return hasExactKeys(form, ["form", "name"], ["form", "name"]) && typeof form.name === "string" && rustIdentifierPattern.test(form.name) &&
          ((operationKind === "property" && runtimeSourceIndexes.length === 0) ||
            (operationKind === "property-set" && runtimeSourceIndexes.length === 1))
        ? undefined
        : "field form must contain one Rust identifier with the exact property read/write arity";
    case "arg-receiver-method": {
      if (!hasExactKeys(form, ["form", "name", "argModes", "argConversions"], ["form", "name"]) ||
        typeof form.name !== "string" || !rustIdentifierPattern.test(form.name)) {
        return "argument-receiver method form is malformed";
      }
      const modeViolation = validateModes(form.argModes);
      if (modeViolation !== undefined) {
        return modeViolation;
      }
      return form.argConversions === undefined ||
          isDenseDataArray(form.argConversions) &&
          form.argConversions.length === runtimeSourceIndexes.length &&
          form.argConversions[0] === undefined &&
          form.argConversions.every((conversion) =>
            conversion === undefined || rustValueConversionContract(conversion) !== undefined)
        ? undefined
        : "argument-receiver method conversions must exactly cover source arguments without converting the receiver argument";
    }
    case "arg-structural-method":
      return hasExactKeys(
        form,
        ["form", "storageIndex", "argModes", "argConversions", "trailingArguments"],
        ["form", "storageIndex", "argModes"],
      ) && operationKind === "method" && runtimeSourceIndexes.length >= 1 &&
        Number.isSafeInteger(form.storageIndex) && form.storageIndex >= 0 &&
        validateModes(form.argModes) === undefined &&
        (form.argConversions === undefined ||
          isDenseDataArray(form.argConversions) &&
          form.argConversions.length === runtimeSourceIndexes.length &&
          form.argConversions[0] === undefined &&
          form.argConversions.every((conversion) =>
            conversion === undefined || rustValueConversionContract(conversion) !== undefined)) &&
        (form.trailingArguments === undefined ||
          isDenseDataArray(form.trailingArguments) &&
          form.trailingArguments.every((argument) => constantIsValid(argument)))
        ? undefined
        : "argument structural-method form requires one exact storage index, receiver/argument metadata, closed trailing constants, and at least one source argument";
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
    case "trait-call":
      return hasExactKeys(
        form,
        ["form", "owner", "traitPath", "traitGenericArguments", "method", "receiverMode", "argModes"],
        ["form", "owner", "traitPath", "traitGenericArguments", "method"],
      ) && isRustTargetTypeRef(form.owner) && typeof form.traitPath === "string" &&
        rustPathPattern.test(form.traitPath) && Array.isArray(form.traitGenericArguments) &&
        form.traitGenericArguments.every(isRustTargetGenericArgument) && typeof form.method === "string" &&
        rustIdentifierPattern.test(form.method) &&
        (form.receiverMode === undefined || modes.has(form.receiverMode)) &&
        validateModes(form.argModes) === undefined
        ? undefined
        : "trait call must carry one exact owner, trait identity, method, receiver mode, and argument modes";
    case "trait-associated-value":
      return hasExactKeys(
        form,
        ["form", "owner", "traitPath", "traitGenericArguments", "name"],
        ["form", "owner", "traitPath", "traitGenericArguments", "name"],
      ) && isRustTargetTypeRef(form.owner) && typeof form.traitPath === "string" &&
        rustPathPattern.test(form.traitPath) && Array.isArray(form.traitGenericArguments) &&
        form.traitGenericArguments.every(isRustTargetGenericArgument) && typeof form.name === "string" &&
        rustIdentifierPattern.test(form.name) &&
        runtimeSourceIndexes.length === 0 &&
        (operationKind === "property" || operationKind === "method")
        ? undefined
        : "trait associated value must carry one exact owner, trait identity, and zero runtime arguments";
    case "associated-value":
      return hasExactKeys(
        form,
        ["form", "owner", "name"],
        ["form", "owner", "name"],
      ) && isRustTargetTypeRef(form.owner) && typeof form.name === "string" &&
        rustIdentifierPattern.test(form.name) && runtimeSourceIndexes.length === 0 &&
        (operationKind === "property" || operationKind === "method")
        ? undefined
        : "associated value must carry one exact owner, Rust identifier, and zero runtime arguments";
    case "call":
      if (!hasExactKeys(form, ["form", "path", "argModes", "argConversions", "argOrder", "trailingArguments", "chain"], ["form", "path"]) ||
        typeof form.path !== "string" || !rustPathPattern.test(form.path)) {
        return "call form is malformed";
      }
      return validateArguments(form);
    case "source-module-construction": {
      if (!hasExactKeys(
        form,
        ["form", "path", "sourceArgumentIndex", "targetArgumentIndex", "bootstrap", "argModes", "argConversions", "argOrder"],
        ["form", "path", "sourceArgumentIndex", "targetArgumentIndex", "bootstrap"],
      ) || operationKind !== "constructor" || typeof form.path !== "string" ||
        !rustPathPattern.test(form.path) ||
        !Number.isSafeInteger(form.sourceArgumentIndex) || form.sourceArgumentIndex < 0 ||
        !Number.isSafeInteger(form.targetArgumentIndex) || form.targetArgumentIndex < 0 ||
        form.sourceArgumentIndex >= sourceArgumentCount ||
        form.targetArgumentIndex >= runtimeSourceIndexes.length ||
        !sourceModuleBootstrapIsValid(form.bootstrap)) {
        return "source-module construction form is malformed";
      }
      const violation = validateArguments(form);
      if (violation !== undefined) return violation;
      const order = form.argOrder ?? runtimeSourceIndexes;
      return order[form.targetArgumentIndex] === form.sourceArgumentIndex
        ? undefined
        : "source-module construction indexes do not identify one exact target argument";
    }
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

function sourceModuleBootstrapIsValid(
  value: Extract<RustProviderOperationForm, {
    readonly form: "source-module-construction";
  }>["bootstrap"],
): boolean {
  return isRecord(value) &&
    hasExactKeys(
      value,
      ["id", "path", "errorBoundary", "errorCarrier"],
      ["id", "path", "errorBoundary"],
    ) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.path === "string" && rustPathPattern.test(value.path) &&
    (value.errorBoundary === "provider-native"
      ? value.errorCarrier !== undefined && isRustTargetTypeRef(value.errorCarrier)
      : (value.errorBoundary === "target-runtime" || value.errorBoundary === "source-program") &&
        value.errorCarrier === undefined);
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
  if (value.kind === "float64") {
    return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) &&
      typeof value.value === "number" && Number.isFinite(value.value);
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
