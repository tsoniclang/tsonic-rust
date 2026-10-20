import { rustStringTargetType } from "../../../target-model/types/index.js";

import { isRustCVariadicArgumentCarrier } from "../callables/c-variadic.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

import { selectRustSourceValueConversion } from "../../conversions/selection.js";

import type { RustProviderOperationForm } from "../../../target-model/operations/model.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
export function incompatibleRustProviderSourceArgument(form: RustProviderOperationForm, actual: readonly TargetTypeRef[], definitions: RustTypeDefinitions): number | undefined {
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice") {
    const stringCarrier = rustStringTargetType();
    return actual.every((carrier) => carrier !== undefined && rustTargetTypeRefEquals(carrier, stringCarrier))
      ? undefined : 0;
  }
  if (form.form === "call-value-slice" || form.form === "call-value-array" ||
    form.form === "receiver-value-array") {
    const form = form;
    if (actual.length < form.leadingArguments.length) {
      return actual.length;
    }
    return undefined;
  }
  if (form.form === "receiver-tagged-array") {
    const form = form;
    if (actual.length < form.leadingArguments.length) {
      return actual.length;
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) => {
      if (carrier === undefined) {
        return true;
      }
      if (sourceIndex < form.leadingArguments.length) {
        const target = form.leadingArguments[sourceIndex]!.carrier;
        return !rustTargetTypeRefEquals(carrier, target) &&
          selectRustSourceValueConversion(carrier, target, definitions) === undefined;
      }
      const exact = form.alternatives.filter((alternative) =>
        rustTargetTypeRefEquals(carrier, alternative.inputCarrier));
      const convertible = exact.length > 0
        ? []
        : form.alternatives.filter((alternative) =>
            selectRustSourceValueConversion(carrier, alternative.inputCarrier, definitions) !== undefined);
      return (exact.length > 0 ? exact : convertible).length !== 1;
    });
    return incompatible < 0
      ? undefined : incompatible;
  }
  if (form.form === "call-c-variadic") {
    const form = form;
    if (actual.length < form.fixedArgumentModes.length) {
      return actual.length;
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) =>
      sourceIndex >= form.fixedArgumentModes.length &&
      !isRustCVariadicArgumentCarrier(carrier));
    return incompatible < 0
      ? undefined : incompatible;
  }
  return undefined;
}

export function selectedCallArgumentTargetCarrier(
  form: RustProviderOperationForm,
  sourceIndex: number,
): TargetTypeRef | undefined {
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice") {
    return rustStringTargetType();
  }
  if (form.form === "call-value-slice" || form.form === "call-value-array" ||
    form.form === "receiver-value-array") {
    return sourceIndex < form.leadingArguments.length
      ? form.leadingArguments[sourceIndex]!.carrier
      : form.elementCarrier;
  }
  if (form.form === "receiver-tagged-array" && sourceIndex < form.leadingArguments.length) {
    return form.leadingArguments[sourceIndex]!.carrier;
  }
  return undefined;
}

export function providerFormRequiresSourceReceiver(form: RustProviderOperationForm): boolean {
  return form.form === "method" ||
    form.form === "field" ||
    form.form === "index" ||
    form.form === "free-call" ||
    form.form === "free-call-str-slice" ||
    form.form === "receiver-method" ||
    form.form === "receiver-value-array" ||
    form.form === "receiver-tagged-array" ||
    form.form === "arg-receiver-method" ||
    form.form === "arg-structural-method" ||
    (form.form === "trait-call" && form.receiverMode !== undefined);
}
