import { isRustBinaryOperator, rustBinaryOperatorTraitPath } from "../../../target-model/syntax/tokens.js";
import { requireExactKeys, requireRustIdentifier, requireRustPath, validateCarrier, validateValueConversion } from "./carriers.js";
import type { Fail } from "./model.js";
import type { RustProviderConstantArgument, RustProviderOperationForm } from "../../../target-model/operations/model.js";
import type { RustProviderPackageDefinition } from "../index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function validateOperationForm(
  operationKind: RustProviderPackageDefinition["operations"][number]["operationKind"],
  form: RustProviderOperationForm,
  definition: RustProviderPackageDefinition,
  label: string,
  parameterCarriers: readonly TargetTypeRef[] | undefined,
  fail: Fail,
): void {
  void operationKind;
  const record = form as unknown as Readonly<Record<string, unknown>>;
  switch (form.form) {
    case "marker":
      requireExactKeys(record, ["form"], `${label}.target`, fail);
      return;
    case "call":
      requireExactKeys(record, ["form", "path", "argModes", "argConversions", "argOrder", "trailingArguments", "chain"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      validateTrailingArguments(form.trailingArguments, label, fail);
      validateChain(form.chain, label, fail);
      return;
    case "call-c-variadic":
      requireExactKeys(record, ["form", "path", "fixedArgumentModes"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateModes(form.fixedArgumentModes, label, parameterCarriers?.length, fail);
      return;
    case "call-str-slice":
      requireExactKeys(record, ["form", "path"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      return;
    case "call-ref-slice":
      requireExactKeys(record, ["form", "path", "elementCarrier"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateCarrier(form.elementCarrier, definition, `${label}.target.elementCarrier`, fail);
      return;
    case "path":
    case "static":
      requireExactKeys(record, ["form", "path"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      return;
    case "free-call-str-slice":
      requireExactKeys(record, ["form", "path", "receiverMode"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      return;
    case "free-call-ref-slice":
      requireExactKeys(record, ["form", "path", "receiverMode", "elementCarrier"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateCarrier(form.elementCarrier, definition, `${label}.target.elementCarrier`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      return;
    case "call-value-slice":
    case "call-value-array":
      requireExactKeys(record, ["form", "path", "leadingArguments", "elementCarrier"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      validateValueSliceArguments(form, definition, label, fail);
      return;
    case "receiver-value-array":
      requireExactKeys(record, ["form", "name", "receiverMode", "leadingArguments", "elementCarrier"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      validateValueSliceArguments(form, definition, label, fail);
      return;
    case "receiver-tagged-array":
      requireExactKeys(
        record,
        ["form", "name", "receiverMode", "leadingArguments", "elementCarrier", "alternatives"],
        `${label}.target`,
        fail,
      );
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      validateValueSliceArguments(form, definition, label, fail);
      if (!Array.isArray(form.alternatives) || form.alternatives.length === 0) {
        fail(`${label}.target.alternatives must be a non-empty dense array`);
      }
      for (const [index, alternative] of form.alternatives.entries()) {
        requireExactKeys(
          alternative,
          ["inputCarrier", "mode", "constructorPath"],
          `${label}.target.alternatives[${index}]`,
          fail,
        );
        validateCarrier(
          alternative.inputCarrier,
          definition,
          `${label}.target.alternatives[${index}].inputCarrier`,
          fail,
        );
        if (alternative.mode !== "value" && alternative.mode !== "ref" && alternative.mode !== "mut-ref") {
          fail(`${label}.target.alternatives[${index}].mode contains unsupported mode '${String(alternative.mode)}'`);
        }
        requireRustPath(alternative.constructorPath, `${label}.target.alternatives[${index}].constructorPath`, fail);
      }
      return;
    case "method":
    case "arg-method":
    case "field":
      requireExactKeys(record, ["form", "name"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      return;
    case "arg-receiver-method":
      requireExactKeys(record, ["form", "name", "argModes", "argConversions"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      validateModes(form.argModes, label, parameterCarriers?.length, fail);
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      if (form.argConversions?.[0] !== undefined) {
        fail(`${label}.target.argConversions[0] cannot convert the receiver argument`);
      }
      return;
    case "arg-structural-method":
      requireExactKeys(record, ["form", "storageIndex", "argModes", "argConversions", "trailingArguments"], `${label}.target`, fail);
      if (!Number.isSafeInteger(form.storageIndex) || form.storageIndex < 0) {
        fail(`${label}.target.storageIndex must be one non-negative safe integer`);
      }
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      if (form.argConversions !== undefined &&
        parameterCarriers !== undefined &&
        form.argConversions.length !== parameterCarriers.length) {
        fail(`${label}.target.argConversions must exactly cover every source argument when present`);
      }
      if (form.argConversions?.[0] !== undefined) {
        fail(`${label}.target.argConversions[0] cannot convert the source receiver`);
      }
      validateTrailingArguments(form.trailingArguments, label, fail);
      return;
    case "index":
      requireExactKeys(record, ["form", "indexConversion"], `${label}.target`, fail);
      if (form.indexConversion !== undefined) {
        validateValueConversion(
          form.indexConversion,
          definition,
          `${label}.target.indexConversion`,
          parameterCarriers?.[0],
          undefined,
          fail,
        );
      }
      return;
    case "free-call":
      requireExactKeys(record, ["form", "path", "receiverMode", "argModes", "argConversions", "trailingArguments", "argOrder"], `${label}.target`, fail);
      requireRustPath(form.path, `${label}.target.path`, fail);
      if (form.receiverMode !== "value" && form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      validateTrailingArguments(form.trailingArguments, label, fail);
      return;
    case "binary-operator":
      requireExactKeys(record, ["form", "operator", "trait"], `${label}.target`, fail);
      if (!isRustBinaryOperator(form.operator)) {
        fail(`${label}.target.operator '${String(form.operator)}' is not a Rust binary operator`);
      }
      requireRustPath(form.trait, `${label}.target.trait`, fail);
      if (isRustBinaryOperator(form.operator)) {
        const expectedTrait = rustBinaryOperatorTraitPath(form.operator);
        const actualTrait = expandValidationAlias(form.trait, definition.aliasImports);
        if (expectedTrait === undefined || actualTrait !== expectedTrait) {
          fail(`${label}.target operator '${form.operator}' requires exact trait '${expectedTrait ?? "<unsupported>"}', received '${actualTrait}'`);
        }
      }
      return;
    case "trait-call":
      requireExactKeys(
        record,
        ["form", "owner", "traitPath", "traitTypeArguments", "method", "receiverMode", "argModes"],
        `${label}.target`,
        fail,
      );
      validateCarrier(form.owner, definition, `${label}.target.owner`, fail);
      requireRustPath(form.traitPath, `${label}.target.traitPath`, fail);
      requireRustIdentifier(form.method, `${label}.target.method`, fail);
      for (const [index, argument] of form.traitTypeArguments.entries()) {
        validateCarrier(argument, definition, `${label}.target.traitTypeArguments[${index}]`, fail);
      }
      if (form.receiverMode !== undefined && form.receiverMode !== "value" &&
        form.receiverMode !== "ref" && form.receiverMode !== "mut-ref") {
        fail(`${label}.target.receiverMode contains unsupported mode '${String(form.receiverMode)}'`);
      }
      validateModes(form.argModes, label, parameterCarriers?.length, fail);
      return;
    case "trait-associated-value":
      requireExactKeys(
        record,
        ["form", "owner", "traitPath", "traitTypeArguments", "name"],
        `${label}.target`,
        fail,
      );
      validateCarrier(form.owner, definition, `${label}.target.owner`, fail);
      requireRustPath(form.traitPath, `${label}.target.traitPath`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      for (const [index, argument] of form.traitTypeArguments.entries()) {
        validateCarrier(argument, definition, `${label}.target.traitTypeArguments[${index}]`, fail);
      }
      return;
    case "receiver-method":
      requireExactKeys(record, ["form", "name", "argModes", "argConversions", "argOrder", "chain", "mutatesReceiver"], `${label}.target`, fail);
      requireRustIdentifier(form.name, `${label}.target.name`, fail);
      if (form.mutatesReceiver !== undefined && typeof form.mutatesReceiver !== "boolean") {
        fail(`${label}.target.mutatesReceiver must be boolean when present`);
      }
      validateArgumentMetadata(form, definition, label, parameterCarriers, fail);
      validateChain(form.chain, label, fail);
      return;
    default:
      fail(`${label}.target has unsupported operation form '${String((form as { readonly form?: unknown }).form)}'`);
  }
}

function validateValueSliceArguments(
  form: Extract<RustProviderOperationForm, {
    readonly form: "call-value-slice" | "call-value-array" | "receiver-value-array" | "receiver-tagged-array";
  }>,
  definition: RustProviderPackageDefinition,
  label: string,
  fail: Fail,
): void {
  if (!Array.isArray(form.leadingArguments)) {
    fail(`${label}.target.leadingArguments must be a dense array`);
  }
  for (const [index, argument] of form.leadingArguments.entries()) {
    requireExactKeys(argument, ["carrier", "mode"], `${label}.target.leadingArguments[${index}]`, fail);
    validateCarrier(argument.carrier, definition, `${label}.target.leadingArguments[${index}].carrier`, fail);
    if (argument.mode !== "value" && argument.mode !== "ref" && argument.mode !== "mut-ref") {
      fail(`${label}.target.leadingArguments[${index}].mode contains unsupported mode '${String(argument.mode)}'`);
    }
  }
  validateCarrier(form.elementCarrier, definition, `${label}.target.elementCarrier`, fail);
}

function expandValidationAlias(
  path: string,
  aliases: RustProviderPackageDefinition["aliasImports"],
): string {
  const separator = path.indexOf("::");
  const root = separator < 0 ? path : path.slice(0, separator);
  const replacement = aliases?.find((entry) => entry.alias === root)?.path;
  return replacement === undefined
    ? path
    : separator < 0 ? replacement : `${replacement}${path.slice(separator)}`;
}

function validateArgumentMetadata(
  form: Extract<RustProviderOperationForm, {
    readonly form: "call" | "free-call" | "receiver-method" | "arg-receiver-method" | "arg-structural-method";
  }>,
  definition: RustProviderPackageDefinition,
  label: string,
  parameterCarriers: readonly TargetTypeRef[] | undefined,
  fail: Fail,
): void {
  const parameterCount = parameterCarriers?.length;
  validateModes(form.argModes, label, parameterCount, fail);
  if (parameterCount !== undefined && form.argConversions !== undefined && form.argConversions.length > parameterCount) {
    fail(`${label}.target.argConversions has ${form.argConversions.length} entries for ${parameterCount} parameters`);
  }
  for (const [targetIndex, conversion] of (form.argConversions ?? []).entries()) {
    if (conversion !== undefined) {
      const sourceIndex = "argOrder" in form
        ? form.argOrder?.[targetIndex] ?? targetIndex
        : targetIndex;
      validateValueConversion(
        conversion,
        definition,
        `${label}.target.argConversions[${targetIndex}]`,
        parameterCarriers?.[sourceIndex],
        undefined,
        fail,
      );
    }
  }
  if ("argOrder" in form && form.argOrder !== undefined) {
    if (parameterCount !== undefined && form.argOrder.length !== parameterCount) {
      fail(`${label}.target.argOrder must contain exactly ${parameterCount} parameter indexes`);
    }
    const indexes = new Set<number>();
    for (const index of form.argOrder) {
      if (!Number.isSafeInteger(index) || index < 0 || (parameterCount !== undefined && index >= parameterCount) || indexes.has(index)) {
        fail(`${label}.target.argOrder is not a valid parameter permutation`);
      }
      indexes.add(index);
    }
  }
}

function validateModes(
  modes: readonly unknown[] | undefined,
  label: string,
  parameterCount: number | undefined,
  fail: Fail,
): void {
  if (parameterCount !== undefined && modes !== undefined && modes.length !== parameterCount) {
    fail(`${label}.target.argModes must contain exactly ${parameterCount} entries when present`);
  }
  for (const mode of modes ?? []) {
    if (mode !== "value" && mode !== "ref" && mode !== "mut-ref") {
      fail(`${label}.target.argModes contains unsupported mode '${String(mode)}'`);
    }
  }
}

function validateTrailingArguments(
  arguments_: readonly RustProviderConstantArgument[] | undefined,
  label: string,
  fail: Fail,
): void {
  for (const [index, argument] of (arguments_ ?? []).entries()) {
    const record = argument as unknown as Readonly<Record<string, unknown>>;
    if (argument.kind === "integer") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (!Number.isSafeInteger(argument.value)) {
        fail(`${label}.target.trailingArguments[${index}] must contain a safe integer`);
      }
      continue;
    }
    if (argument.kind === "float64") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (typeof argument.value !== "number" || !Number.isFinite(argument.value)) {
        fail(`${label}.target.trailingArguments[${index}] must contain a finite float64`);
      }
      continue;
    }
    if (argument.kind === "string") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (typeof argument.value !== "string") {
        fail(`${label}.target.trailingArguments[${index}] must contain a string`);
      }
      continue;
    }
    if (argument.kind === "boolean") {
      requireExactKeys(record, ["kind", "value"], `${label}.target.trailingArguments[${index}]`, fail);
      if (typeof argument.value !== "boolean") {
        fail(`${label}.target.trailingArguments[${index}] must contain a boolean`);
      }
      continue;
    }
    if (argument.kind === "none") {
      requireExactKeys(record, ["kind"], `${label}.target.trailingArguments[${index}]`, fail);
      continue;
    }
    fail(`${label}.target.trailingArguments[${index}] has unsupported kind '${String((argument as { readonly kind?: unknown }).kind)}'`);
  }
}

function validateChain(
  chain: Extract<RustProviderOperationForm, { readonly form: "call" | "receiver-method" }>["chain"],
  label: string,
  fail: Fail,
): void {
  for (const [index, step] of (chain ?? []).entries()) {
    const record = step as unknown as Readonly<Record<string, unknown>>;
    if (step.kind === "copy-selected-carrier") {
      requireExactKeys(record, ["kind"], `${label}.target.chain[${index}]`, fail);
      continue;
    }
    if (step.kind !== "method") {
      fail(`${label}.target.chain[${index}] must be a structured provider chain step`);
    }
    requireExactKeys(record, ["kind", "name"], `${label}.target.chain[${index}]`, fail);
    requireRustIdentifier(step.name, `${label}.target.chain[${index}].name`, fail);
  }
}
