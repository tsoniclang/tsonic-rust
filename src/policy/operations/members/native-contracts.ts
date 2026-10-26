import type { RustStructuralStorageLookup, RustProjectFieldDispatchLookup } from "../../model/operation-record-inputs.js";
import { emptyRustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { isRustFinalizedArrayInput, isRustFinalizedSliceInput, isRustFinalizedSourceInput, isRustFinalizedTaggedArrayInput } from "../../../target-model/operations/finalized-inputs.js";
import type { RustFinalizedOperationAbi } from "../../../target-model/records/finalized-operation.js";
import { rustValueConversionIsFallible } from "../../conversions/contracts.js";

import type { RustStructuralShapeField } from "../../../target-model/records/structural-shapes.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustCarrierProvidesErrorMutation } from "../../constraints/error-protocols.js";

export function rustSourceCallCallableStorageCarrier(
  fact: RustTargetOperationFact | undefined,
  storage: RustStructuralStorageLookup,
): TargetTypeRef | undefined {
  if (fact?.kind !== "source-call") return undefined;
  const target = fact.target;
  if (target.form === "callable") return target.carrier;
  if (target.form === "constructor-value") return target.callableCarrier;
  if (target.form !== "structural-method") return undefined;
  const field = storage.field(target.receiverCarrier, target.storageIndex);
  if (field?.methodPlan?.kind === "fixed") return undefined;
  return field?.presence === "optional" ? rustOptionElementCarrier(field.methodPlan?.carrier) : field?.methodPlan?.carrier;
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

export function rustTargetOperationSupportsAssignment(fact: RustTargetOperationFact | undefined, definitions: RustTypeDefinitions): boolean {
  return (fact?.kind === "source-field" &&
      (fact.valueSemantics.kind === "stored" ||
        fact.valueSemantics.kind === "accessor" && fact.valueSemantics.writable)) ||
    (fact?.kind === "builtin-error-property" && fact.accessMode !== "read" &&
      rustCarrierProvidesErrorMutation(fact.receiverCarrier, definitions)) ||
    fact?.kind === "source-static-field" ||
    (fact?.kind === "source-union-field" && fact.selectedVariantIndexes.every((index) => {
      const field = fact.variants[index]?.field;
      return field !== undefined &&
        (field.valueSemantics.kind === "stored" ||
          field.valueSemantics.kind === "accessor" && field.valueSemantics.writable);
    })) ||
    (fact?.kind === "source-index-signature" && fact.writable) ||
    (fact?.kind === "source-indexed-field" && fact.accessMode !== "read") ||
    (fact?.kind === "source-method-property" && fact.write !== undefined) ||
    (fact?.kind === "source-accessor" && fact.write !== undefined) ||
    rustTargetOperationIsDirectLocation(fact);
}

export function rustTargetOperationIsFallible(
  fact: RustTargetOperationFact | undefined,
  structuralStorage: RustStructuralStorageLookup,
  projectFieldDispatch: RustProjectFieldDispatchLookup,
  frozenDataWrites: import("../../../target-model/records/frozen-data.js").RustFrozenDataWritePlan,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  if (fact === undefined) {
    return false;
  }
  if (fact.kind === "regexp-create") {
    return true;
  }
  if (fact.kind === "union-property") return fact.variants.some(variant => variant.operation !== undefined &&
    rustTargetOperationIsFallible(variant.operation, structuralStorage, projectFieldDispatch, frozenDataWrites, definitions));
  if (fact.kind === "typed-location") {
    return fact.operation === "load" || fact.operation === "store";
  }
  if (fact.kind === "iteration") {
    return fact.iterationKind !== "for-in" && fact.lowering.kind === "fallible-owned";
  }
  if (fact.kind === "source-conversion") {
    return rustValueConversionIsFallible(fact.conversion, definitions);
  }
  if (fact.kind === "source-accessor") {
    return false;
  }
  if (fact.kind === "source-indexed-field") return true;
  if (fact.kind === "source-method-property") {
    return fact.accessMode !== "read" && frozenDataWrites.receiverForDeclaration(fact.declaration) !== undefined;
  }
  if (fact.kind === "source-field") {
    if (fact.accessMode !== "read" && fact.valueSemantics.kind === "stored" &&
      frozenDataWrites.receiverFor(fact.storage, fact.receiverCarrier, fact.storageIndex) !== undefined) return true;
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
      fact.storage === "structural-object" &&
        rustStructuralFieldIsFallible(structuralStorage.field(fact.receiverCarrier, fact.storageIndex));
  }
  if (fact.kind === "source-union-field") {
    return fact.selectedVariantIndexes.some((index) => {
      const variant = fact.variants[index];
      const field = variant?.field;
      return variant !== undefined && field !== undefined && rustTargetOperationIsFallible({
        kind: "source-field", operationId: fact.operationId, accessMode: fact.accessMode,
        receiverCarrier: variant.carrier, resultCarrier: fact.resultCarrier, ...field,
      }, structuralStorage, projectFieldDispatch, frozenDataWrites, definitions);
    });
  }
  if (fact.kind === "object-shape-projection") {
    if (fact.projection === "assign") return fact.assignmentFields?.some(field =>
      frozenDataWrites.receiverFor(fact.storage, fact.sourceValueCarrier, field.targetStorageIndex) !== undefined ||
      fact.storage === "structural-object" && (rustStructuralFieldIsFallible(structuralStorage.field(
        fact.sourceValueCarrier, field.targetStorageIndex)) || fact.assignmentSourceCarrier !== undefined &&
        rustStructuralFieldIsFallible(structuralStorage.field(fact.assignmentSourceCarrier, field.sourceStorageIndex)))) === true;
    return (fact.projection === "values" || fact.projection === "entries") &&
      fact.fields.some((field) => field.accessor !== undefined ||
        fact.storage === "structural-object" && rustStructuralFieldIsFallible(structuralStorage.field(
          fact.sourceValueCarrier,
          field.storageIndex,
        )));
  }
  if (fact.kind === "record-literal") {
    return fact.contributions.some((contribution) =>
      contribution.kind === "spread" &&
      contribution.fields.some((field) => field.accessor !== undefined ||
        contribution.sourceStorage === "structural-object" && rustStructuralFieldIsFallible(structuralStorage.field(
          contribution.sourceValueCarrier,
          field.sourceStorageIndex,
        ))));
  }
  if (fact.kind === "operator-call") {
    return fact.fallible;
  }
  if (fact.kind === "source-call" &&
    (fact.target.form === "callable" || fact.target.form === "structural-method" || fact.target.form === "constructor-value")) {
    if (fact.target.form === "structural-method" &&
      structuralStorage.field(fact.target.receiverCarrier, fact.target.storageIndex)?.methodPlan?.kind === "fixed") return false;
    return rustGenericCallableValue(rustSourceCallCallableStorageCarrier(fact, structuralStorage)) === undefined && (fact.target.form !== "callable" ||
      (fact.target.carrier.kind === "closure"
        ? fact.target.carrier.fallible === true
        : fact.target.carrier.kind !== "function-pointer"));
  }
  if (fact.kind === "provider-operation" || fact.kind === "runtime-set") {
    return rustOperationAbiInvocationIsFallible(fact.abi);
  }
  return false;
}

export function rustOperationAbiInvocationIsFallible(abi: RustFinalizedOperationAbi): boolean {
  return abi.effects.invocation === "fallible" || rustOperationAbiConversionsAreFallible(abi);
}

export function rustOperationAbiConversionsAreFallible(abi: RustFinalizedOperationAbi): boolean {
  if ((abi.targetReceiver.kind === "input" && abi.targetReceiver.input.conversion.fallible) ||
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
  return abi.effects.awaiting === "fallible" ||
    (abi.result.kind === "async" && abi.result.awaitedConversion.fallible);
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

export function rustStructuralFieldIsFallible(field: Pick<RustStructuralShapeField, "storage"> | undefined): boolean {
  return field !== undefined && field.storage !== "stored";
}
