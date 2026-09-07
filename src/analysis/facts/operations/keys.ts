import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustArgumentMode, RustOptionalChainFact, RustProviderFactOperationKind } from "../../../target-model/operations/model.js";
import type { RustPlanKey } from "../../../target-model/facts/keys.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "./facts.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

function rustTargetOperationFactEquals(left: RustTargetOperationFact, right: RustTargetOperationFact): boolean {
  return closedMetadataEquals(left, right);
}

export const rustTargetOperationFactKey: RustPlanKey<RustTargetOperationFact> =
  defineRustPlanKey("targetOperation", rustTargetOperationFactEquals);

export interface RustPreparedOperationResultFact {
  readonly operationId: string;
  readonly operationKind: RustProviderFactOperationKind;
  readonly resultCarrier: TargetTypeRef;
}

export const rustPreparedOperationResultFactKey: RustPlanKey<RustPreparedOperationResultFact> =
  defineRustPlanKey("preparedOperationResult", (left, right) =>
    left.operationId === right.operationId &&
    left.operationKind === right.operationKind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier));

export const rustOptionalChainFactKey: RustPlanKey<RustOptionalChainFact> =
  defineRustPlanKey("optionalChain", closedMetadataEquals);

export const rustTypedLocationPlanKey: RustPlanKey<RustTypedLocationPlan> =
  defineRustPlanKey("typedLocationPlan", rustTypedLocationPlanEquals);

export const rustLocationStorageFactKey: RustPlanKey<{
  readonly valueCarrier: TargetTypeRef;
}> = defineRustPlanKey(
  "locationStorage",
  (left, right) => rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier),
);

export interface RustClosureCaptureFact {
  readonly captures: readonly {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location";
  }[];
  readonly recursiveDeclaration?: Node;
}

export const rustClosureCaptureFactKey: RustPlanKey<RustClosureCaptureFact> = defineRustPlanKey(
  "closureCaptures",
  (left, right) => left.recursiveDeclaration === right.recursiveDeclaration &&
    left.captures.length === right.captures.length &&
    left.captures.every((capture, index) => {
      const other = right.captures[index];
      return other !== undefined &&
        capture.declaration === other.declaration &&
        capture.reference === other.reference &&
        capture.storage === other.storage &&
        rustTargetTypeRefEquals(capture.carrier, other.carrier);
    }),
);

export interface RustSourceCallableValueFact {
  readonly form: "function";
  readonly sourceDeclaration: Node;
  readonly fileName: string;
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly argumentModes: readonly RustArgumentMode[];
  readonly resultCarrier: TargetTypeRef;
}

export const rustSourceCallableValueFactKey: RustPlanKey<RustSourceCallableValueFact> = defineRustPlanKey(
  "sourceCallableValue",
  (left, right) => left.form === right.form &&
    left.sourceDeclaration === right.sourceDeclaration &&
    left.fileName === right.fileName &&
    left.name === right.name &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.parameterCarriers.length === right.parameterCarriers.length &&
    left.parameterCarriers.every((carrier, index) =>
      rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
    left.argumentModes.length === right.argumentModes.length &&
    left.argumentModes.every((mode, index) => mode === right.argumentModes[index]) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier),
);

export type RustModuleBindingFact =
  | {
      readonly declarationKind: "const" | "function";
      readonly storage: "native-const";
      readonly valueCarrier: TargetTypeRef;
    }
  | {
      readonly declarationKind: "const" | "function";
      readonly storage: "native-callable";
      readonly callableDeclaration: Node;
      readonly name: string;
      readonly value?: {
        readonly name: string;
        readonly carrier: TargetTypeRef;
        readonly parameterCarriers: readonly TargetTypeRef[];
        readonly argumentModes: readonly RustArgumentMode[];
        readonly resultCarrier: TargetTypeRef;
      };
    }
  | {
      readonly declarationKind: "const" | "let" | "var";
      readonly storage: "module-cell";
      readonly valueCarrier: TargetTypeRef;
    };

export const rustModuleBindingFactKey: RustPlanKey<RustModuleBindingFact> = defineRustPlanKey(
  "moduleBinding",
  (left, right) => left.declarationKind === right.declarationKind &&
    left.storage === right.storage &&
    (left.storage === "native-callable"
      ? right.storage === "native-callable" &&
        left.callableDeclaration === right.callableDeclaration &&
        left.name === right.name &&
        nativeCallableValuesEqual(left.value, right.value)
      : right.storage !== "native-callable" &&
        rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier)),
);

function nativeCallableValuesEqual(
  left: Extract<RustModuleBindingFact, { readonly storage: "native-callable" }>["value"],
  right: Extract<RustModuleBindingFact, { readonly storage: "native-callable" }>["value"],
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
      rustTargetTypeRefEquals(left.carrier, right.carrier) &&
      left.name === right.name &&
      left.parameterCarriers.length === right.parameterCarriers.length &&
      left.parameterCarriers.every((carrier, index) =>
        rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
      left.argumentModes.length === right.argumentModes.length &&
      left.argumentModes.every((mode, index) => mode === right.argumentModes[index]) &&
      rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier);
}

function rustTypedLocationPlanEquals(
  left: RustTypedLocationPlan,
  right: RustTypedLocationPlan,
): boolean {
  if (left.operation !== right.operation || left.call !== right.call ||
    !rustTargetTypeRefEquals(left.pointeeCarrier, right.pointeeCarrier) ||
    !rustTargetTypeRefEquals(left.locationCarrier, right.locationCarrier)) {
    return false;
  }
  switch (left.operation) {
    case "address-of":
      return right.operation === "address-of" &&
        left.storageExpression === right.storageExpression &&
        left.storageDeclaration === right.storageDeclaration &&
        left.rootExpression === right.rootExpression &&
        left.rootDeclaration === right.rootDeclaration &&
        left.locationIdentity === right.locationIdentity;
    case "allocate":
      return right.operation === "allocate" &&
        left.initialExpression === right.initialExpression &&
        left.locationIdentity === right.locationIdentity;
    case "load":
      return right.operation === "load" &&
        left.pointerExpression === right.pointerExpression;
    case "store":
      return right.operation === "store" &&
        left.pointerExpression === right.pointerExpression &&
        left.valueExpression === right.valueExpression;
    case "equal-pointer":
      return right.operation === "equal-pointer" &&
        left.leftExpression === right.leftExpression &&
        left.rightExpression === right.rightExpression;
    case "hash-pointer":
      return right.operation === left.operation && left.pointerExpression === right.pointerExpression;
    case "bind-pointer":
      return right.operation === left.operation &&
        left.identityExpression === right.identityExpression &&
        left.readExpression === right.readExpression &&
        left.writeExpression === right.writeExpression;
    case "project-pointer":
      return right.operation === left.operation &&
        left.pointerExpression === right.pointerExpression &&
        left.optional === right.optional &&
        left.fromSourceExpression === right.fromSourceExpression &&
        left.toSourceExpression === right.toSourceExpression &&
        rustTargetTypeRefEquals(left.sourcePointeeCarrier, right.sourcePointeeCarrier);
  }
}
