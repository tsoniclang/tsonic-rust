import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustArgumentMode, RustProviderOperationForm } from "../../target-model/operations/model.js";
import type { RustFallibleErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { RustPlanKey } from "../../target-model/facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";

export type RustTypeAliasDeclarationFact =
  | {
      readonly kind: "string-literal";
      readonly variants: readonly {
        readonly name: string;
        readonly literal: string;
      }[];
    }
  | {
      readonly kind: "runtime";
      readonly variants: readonly {
        readonly name: string;
        readonly carrier: TargetTypeRef;
      }[];
    }
  | {
      readonly kind: "native-alias";
      readonly target: TargetTypeRef;
    }
  | { readonly kind: "erased" };

export const rustTypeAliasDeclarationFactKey: RustPlanKey<RustTypeAliasDeclarationFact> =
  defineRustPlanKey("typeAliasDeclaration", (left, right) =>
    left.kind === right.kind && (left.kind !== "native-alias" ||
      right.kind === "native-alias" && rustTargetTypeRefEquals(left.target, right.target)) &&
    (left.kind === "native-alias" || closedMetadataEquals(left, right)));

export type RustSuspendedCallableStorage =
  | { readonly kind: "static" }
  | { readonly kind: "receiver" }
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetimeRef };

export type RustAsyncFunctionFact =
  | {
      readonly kind: "native-future";
      readonly isAsync: true;
      readonly futureCarrier: TargetTypeRef;
      readonly outputCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "js-promise";
      readonly isAsync: true;
      readonly futureCarrier: TargetTypeRef;
      readonly outputCarrier: TargetTypeRef;
      readonly capturedParameters: readonly Node[];
      readonly storage: RustSuspendedCallableStorage;
    };

export const rustAsyncFunctionFactKey: RustPlanKey<RustAsyncFunctionFact> =
  defineRustPlanKey("asyncFunction", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.futureCarrier, right.futureCarrier) &&
    rustTargetTypeRefEquals(left.outputCarrier, right.outputCarrier) &&
    (left.kind === "native-future" || right.kind === "native-future" ||
      left.capturedParameters.length === right.capturedParameters.length &&
      left.capturedParameters.every((parameter, index) =>
        parameter === right.capturedParameters[index]) &&
      suspendedCallableStorageEquals(left.storage, right.storage)));

export interface RustGeneratorFact {
  readonly kind: "sync" | "async";
  readonly resultCarrier: TargetTypeRef;
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
  readonly capturedParameters: readonly Node[];
  readonly storage: RustSuspendedCallableStorage;
}

export const rustGeneratorFactKey: RustPlanKey<RustGeneratorFact> =
  defineRustPlanKey("generator", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.returnType, right.returnType) &&
    rustTargetTypeRefEquals(left.nextType, right.nextType) &&
    left.capturedParameters.length === right.capturedParameters.length &&
    left.capturedParameters.every((parameter, index) =>
      parameter === right.capturedParameters[index]) &&
    left.storage.kind === right.storage.kind &&
    suspendedCallableStorageEquals(left.storage, right.storage));

function suspendedCallableStorageEquals(
  left: RustSuspendedCallableStorage,
  right: RustSuspendedCallableStorage,
): boolean {
  return left.kind === right.kind &&
    (left.kind !== "lifetime" ||
      right.kind === "lifetime" &&
      rustLifetimesEqual(left.lifetime, right.lifetime));
}

export interface RustYieldFact {
  readonly generatorDeclaration: Node;
  readonly kind: "value" | "delegate";
  readonly yieldType: TargetTypeRef;
  readonly resultType: TargetTypeRef;
  readonly delegatedCarrier?: TargetTypeRef;
}

export const rustYieldFactKey: RustPlanKey<RustYieldFact> =
  defineRustPlanKey("yield", (left, right) =>
    left.generatorDeclaration === right.generatorDeclaration &&
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.resultType, right.resultType) &&
    (left.delegatedCarrier === undefined
      ? right.delegatedCarrier === undefined
      : right.delegatedCarrier !== undefined &&
        rustTargetTypeRefEquals(left.delegatedCarrier, right.delegatedCarrier)));

export type RustResourceDisposalTarget =
  | {
      readonly form: "source-method";
      readonly name: string;
      readonly receiverMode: "ref" | "mut-ref";
      readonly dispatch?: {
        readonly virtualSlot: string;
        readonly ownerCarrier: TargetTypeRef;
      };
    }
  | {
      readonly form: "provider";
      readonly target: RustProviderOperationForm;
    };

export interface RustResourceManagementFact {
  readonly declarationKind: "using" | "await using";
  readonly storageCarrier: TargetTypeRef;
  readonly resourceCarrier: TargetTypeRef;
  readonly nullable: boolean;
  readonly disposal: {
    readonly kind: "sync" | "async";
    readonly target: RustResourceDisposalTarget;
  } & (
    | {
        readonly fallible: true;
        readonly errorBoundary: "provider-native";
        readonly errorCarrier: TargetTypeRef;
      }
    | {
        readonly fallible: true;
        readonly errorBoundary: Exclude<RustFallibleErrorBoundary, "provider-native">;
        readonly errorCarrier?: never;
      }
    | {
        readonly fallible: false;
        readonly errorBoundary: "none";
        readonly errorCarrier?: never;
      }
  );
}

export const rustResourceManagementFactKey: RustPlanKey<RustResourceManagementFact> =
  defineRustPlanKey("resourceManagement", closedMetadataEquals);

export interface RustSourceParameterAbiFact {
  readonly form: "required" | "optional" | "default" | "rest";
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

export const rustSourceParameterAbiFactKey: RustPlanKey<RustSourceParameterAbiFact> =
  defineRustPlanKey("sourceParameterAbi", closedMetadataEquals);

export interface RustSourceCallableReturnFact {
  readonly returnCarrier: TargetTypeRef;
  readonly undefinedReturn?: boolean;
  readonly fallthroughUndefined?: boolean;
}

export const rustSourceCallableReturnFactKey: RustPlanKey<RustSourceCallableReturnFact> =
  defineRustPlanKey("sourceCallableReturn", (left, right) =>
    rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier) &&
    left.undefinedReturn === right.undefinedReturn && left.fallthroughUndefined === right.fallthroughUndefined);
