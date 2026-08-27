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

export interface RustAsyncFunctionFact {
  readonly isAsync: true;
  readonly outputCarrier: TargetTypeRef;
}

export const rustAsyncFunctionFactKey: RustPlanKey<RustAsyncFunctionFact> =
  defineRustPlanKey("asyncFunction", closedMetadataEquals);

export interface RustGeneratorFact {
  readonly kind: "sync" | "async";
  readonly carrier: TargetTypeRef;
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
  readonly capturedParameters: readonly Node[];
  readonly storage:
    | { readonly kind: "static" }
    | { readonly kind: "receiver" }
    | { readonly kind: "lifetime"; readonly lifetime: RustLifetimeRef };
}

export const rustGeneratorFactKey: RustPlanKey<RustGeneratorFact> =
  defineRustPlanKey("generator", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.returnType, right.returnType) &&
    rustTargetTypeRefEquals(left.nextType, right.nextType) &&
    left.capturedParameters.length === right.capturedParameters.length &&
    left.capturedParameters.every((parameter, index) =>
      parameter === right.capturedParameters[index]) &&
    left.storage.kind === right.storage.kind &&
    (left.storage.kind !== "lifetime" ||
      right.storage.kind === "lifetime" &&
      rustLifetimesEqual(left.storage.lifetime, right.storage.lifetime)));

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
}

export const rustSourceCallableReturnFactKey: RustPlanKey<RustSourceCallableReturnFact> =
  defineRustPlanKey("sourceCallableReturn", (left, right) =>
    rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier));
