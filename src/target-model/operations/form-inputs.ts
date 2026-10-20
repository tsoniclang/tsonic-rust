import type { RustFinalizedOperationKind, RustProviderOperationForm } from "./model.js";

export function rustProviderOperationFormAcceptsTargetGenericArguments(
  form: RustProviderOperationForm,
): boolean {
  return form.form === "call" || form.form === "free-call" || form.form === "method" ||
    form.form === "source-module-construction" ||
    form.form === "receiver-method" || form.form === "arg-method" ||
    form.form === "arg-receiver-method" || form.form === "trait-call" || form.form === "associated-call" ||
    form.form === "call-value-slice" || form.form === "call-value-array";
}

export function rustProviderOperationFormDeclaresWritableInput(
  form: RustProviderOperationForm,
): boolean {
  switch (form.form) {
    case "call":
    case "source-module-construction":
    case "arg-receiver-method":
    case "arg-structural-method":
    case "associated-call":
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
    case "numeric-cast":
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

export function rustProviderOperationSourceReceiverMayMutate(
  form: RustProviderOperationForm,
  operationKind: RustFinalizedOperationKind,
): boolean {
  switch (form.form) {
    case "free-call":
    case "free-call-str-slice":
    case "receiver-value-array":
    case "receiver-tagged-array":
    case "trait-call":
      return form.receiverMode === "mut-ref";
    case "receiver-method":
      return form.mutatesReceiver === true;
    case "arg-receiver-method":
    case "arg-structural-method":
      return form.argModes?.[0] === "mut-ref";
    case "field":
      return operationKind === "property-set";
    case "index":
      return operationKind === "index-set";
    case "marker":
    case "numeric-cast":
    case "path":
    case "reference-path":
    case "static":
    case "call":
    case "source-module-construction":
    case "struct-variant":
    case "associated-call":
    case "expression-macro":
    case "call-c-variadic":
    case "call-str-slice":
    case "call-value-slice":
    case "call-value-array":
    case "method":
    case "arg-method":
    case "binary-operator":
    case "associated-value":
    case "trait-associated-value":
      return false;
  }
}

export function rustProviderOperationSourceArgumentMayMutate(
  form: RustProviderOperationForm,
  sourceIndex: number,
): boolean {
  const orderedMode = (
    argumentModes: readonly RustArgumentMode[] | undefined,
    argumentOrder: readonly number[] | undefined,
  ): RustArgumentMode => {
    const targetIndex = argumentOrder === undefined
      ? sourceIndex
      : argumentOrder.indexOf(sourceIndex);
    return targetIndex < 0 ? "value" : argumentModes?.[targetIndex] ?? "value";
  };
  switch (form.form) {
    case "call":
    case "source-module-construction":
    case "free-call":
    case "receiver-method":
      return orderedMode(form.argModes, form.argOrder) === "mut-ref";
    case "trait-call":
    case "associated-call":
      return (form.argModes?.[sourceIndex] ?? "value") === "mut-ref";
    case "call-c-variadic":
      return (form.fixedArgumentModes[sourceIndex] ?? "value") === "mut-ref";
    case "arg-receiver-method":
    case "arg-structural-method":
      return sourceIndex > 0 && (form.argModes?.[sourceIndex] ?? "value") === "mut-ref";
    case "call-value-slice":
    case "call-value-array":
    case "receiver-value-array":
      return sourceIndex < form.leadingArguments.length &&
        form.leadingArguments[sourceIndex]?.mode === "mut-ref";
    case "receiver-tagged-array":
      return sourceIndex < form.leadingArguments.length
        ? form.leadingArguments[sourceIndex]?.mode === "mut-ref"
        : form.alternatives.some((alternative) => alternative.mode === "mut-ref");
    case "marker":
    case "numeric-cast":
    case "path":
    case "reference-path":
    case "static":
    case "struct-variant":
    case "expression-macro":
    case "free-call-str-slice":
    case "call-str-slice":
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
