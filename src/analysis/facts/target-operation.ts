import type { RustTargetOperationFact } from "./keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
} from "./finalized-operation-abi.js";
import type { RustFinalizedOperationAbi } from "./finalized-operation-abi.js";
import { rustValueConversionIsFallible } from "../../target-model/conversions/contracts.js";

export function rustTargetOperationText(fact: RustTargetOperationFact): string {
  if (fact.kind === "regexp-create") {
    return fact.targetOperation;
  }
  if (fact.kind === "provider-operation") {
    const target = fact.abi.target;
    if (target.form === "call" || target.form === "call-c-variadic" || target.form === "path" || target.form === "static" || target.form === "free-call" ||
      target.form === "call-str-slice" || target.form === "free-call-str-slice" ||
      target.form === "call-ref-slice" || target.form === "free-call-ref-slice" ||
      target.form === "call-value-slice" || target.form === "call-value-array") {
      return target.path;
    }
    if (target.form === "index") {
      return "[]";
    }
    if (target.form === "marker") {
      return "marker";
    }
    if (target.form === "binary-operator") {
      return target.operator;
    }
    if (target.form === "trait-call") {
      return `${target.traitPath}::${target.method}`;
    }
    if (target.form === "trait-associated-value") {
      return `${target.traitPath}::${target.name}`;
    }
    if (target.form === "arg-structural-method") {
      return `structural-method[${target.storageIndex}]`;
    }
    return target.name;
  }
  if (fact.kind === "operator-token" || fact.kind === "operator-call") {
    return fact.operator;
  }
  if (fact.kind === "string-concat") {
    return "+";
  }
  if (fact.kind === "conditional" || fact.kind === "identity-expression" ||
    fact.kind === "non-null-expression" ||
    fact.kind === "template-string" || fact.kind === "typeof" ||
    fact.kind === "void-expression") {
    return fact.operationId;
  }
  if (fact.kind === "switch") {
    return fact.operationId;
  }
  if (fact.kind === "source-conversion") {
    return fact.conversion === undefined ? "identity" : "runtime-conversion";
  }
  if (fact.kind === "project-type-test" || fact.kind === "program-error-type-test") {
    return fact.kind;
  }
  return fact.operationId;
}

export function rustTargetOperationIsDirectLocation(fact: RustTargetOperationFact | undefined): boolean {
  if (fact === undefined) {
    return false;
  }
  if (fact.kind === "tuple-index" || fact.kind === "fixed-index") {
    return true;
  }
  return fact.kind === "provider-operation" &&
    (fact.abi.target.form === "field" || fact.abi.target.form === "index" ||
      fact.abi.target.form === "static");
}

export function rustTargetOperationSupportsAssignment(fact: RustTargetOperationFact | undefined): boolean {
  return (fact?.kind === "source-field" &&
      (fact.valueSemantics.kind === "stored" ||
        fact.valueSemantics.kind === "accessor" && fact.valueSemantics.writable)) ||
    fact?.kind === "source-static-field" ||
    (fact?.kind === "source-union-field" && fact.selectedVariantIndexes.every((index) => {
      const field = fact.variants[index]?.field;
      return field !== undefined &&
        (field.valueSemantics.kind === "stored" ||
          field.valueSemantics.kind === "accessor" && field.valueSemantics.writable);
    })) ||
    (fact?.kind === "source-index-signature" && fact.writable) ||
    (fact?.kind === "source-method-property" && fact.write !== undefined) ||
    (fact?.kind === "source-accessor" && fact.write !== undefined) ||
    rustTargetOperationIsDirectLocation(fact);
}

export interface RustStructuralStorageLookup {
  field(
    carrier: TargetTypeRef,
    storageIndex: number,
  ): { readonly storage: "stored" | "property" } | undefined;
}

export interface RustProjectFieldDispatchLookup {
  planFor(declaration: import("@tsonic/tsts").Node): {
    readonly read: { readonly fallible: boolean };
    readonly write?: { readonly fallible: boolean };
  } | undefined;
}

export function rustTargetOperationIsFallible(
  fact: RustTargetOperationFact | undefined,
  structuralStorage: RustStructuralStorageLookup,
  projectFieldDispatch: RustProjectFieldDispatchLookup,
): boolean {
  if (fact === undefined) {
    return false;
  }
  if (fact.kind === "regexp-create") {
    return true;
  }
  if (fact.kind === "iteration") {
    return fact.iterationKind !== "for-in" && fact.lowering.kind === "fallible-owned";
  }
  if (fact.kind === "source-conversion") {
    return rustValueConversionIsFallible(fact.conversion);
  }
  if (fact.kind === "source-accessor") {
    return false;
  }
  if (fact.kind === "source-field") {
    const projectDispatch = fact.dispatch === undefined
      ? undefined
      : fact.declaration === undefined
        ? undefined
        : projectFieldDispatch.planFor(fact.declaration);
    const dispatchIsFallible = projectDispatch !== undefined && (
      (fact.accessMode === "read" || fact.accessMode === "read-write") &&
        projectDispatch.read.fallible ||
      (fact.accessMode === "write" || fact.accessMode === "read-write") &&
        projectDispatch.write?.fallible === true
    );
    return dispatchIsFallible || fact.valueSemantics.kind === "accessor" ||
      fact.storage === "object-handle" &&
        structuralStorage.field(fact.receiverCarrier, fact.storageIndex)?.storage === "property";
  }
  if (fact.kind === "source-union-field") {
    return fact.selectedVariantIndexes.some((index) => {
      const variant = fact.variants[index];
      const field = variant?.field;
      return field?.valueSemantics.kind === "accessor" ||
        variant !== undefined && field?.storage === "object-handle" &&
          structuralStorage.field(
            variant.carrier,
            field.storageIndex,
          )?.storage === "property";
    });
  }
  if (fact.kind === "object-shape-projection") {
    return (fact.projection === "values" || fact.projection === "entries") &&
      fact.fields.some((field) => field.accessor !== undefined ||
        fact.storage === "object-handle" && structuralStorage.field(
          fact.sourceValueCarrier,
          field.storageIndex,
        )?.storage === "property");
  }
  if (fact.kind === "record-literal") {
    return fact.contributions.some((contribution) =>
      contribution.kind === "spread" &&
      contribution.fields.some((field) => field.accessor !== undefined ||
        contribution.sourceStorage === "object-handle" && structuralStorage.field(
          contribution.sourceCarrier,
          field.sourceStorageIndex,
        )?.storage === "property"));
  }
  if (fact.kind === "operator-call") {
    return fact.fallible;
  }
  if (fact.kind === "source-call" &&
    (fact.target.form === "callable" || fact.target.form === "structural-method")) {
    return fact.target.form === "structural-method" ||
      fact.target.carrier.kind !== "function-pointer";
  }
  if (fact.kind === "provider-operation" || fact.kind === "runtime-set") {
    return rustOperationAbiInvocationIsFallible(fact.abi);
  }
  return false;
}

export function rustOperationAbiInvocationIsFallible(abi: RustFinalizedOperationAbi): boolean {
  if (abi.effects.invocation === "fallible" ||
    (abi.targetReceiver.kind === "input" && abi.targetReceiver.input.conversion.fallible) ||
    abi.targetArguments.some((input) =>
      isRustFinalizedSourceInput(input)
        ? input.conversion.fallible
        : (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) &&
            input.elements.some((element) => element.conversion.fallible) ||
          isRustFinalizedTaggedArrayInput(input) &&
            input.elements.some((element) => element.input.conversion.fallible))) {
    return true;
  }
  return abi.result.kind === "sync" && abi.result.conversion.fallible;
}

export function rustOperationAbiAwaitIsFallible(abi: RustFinalizedOperationAbi): boolean {
  return abi.result.kind === "async" &&
    (abi.effects.awaiting === "fallible" || abi.result.awaitedConversion.fallible);
}

export function rustFinalizedCarrierTransitionMatches(
  source: TargetTypeRef,
  converted: TargetTypeRef | undefined,
  target: TargetTypeRef,
): boolean {
  if (rustTargetTypeRefEquals(source, target)) {
    return converted === undefined;
  }
  return converted !== undefined && rustTargetTypeRefEquals(converted, target);
}
