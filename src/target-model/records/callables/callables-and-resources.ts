import type { Node } from "@tsonic/tsts";
import type { RustArgumentMode } from "../../operations/model.js";
import type { RustFinalizedOperationAbiFor } from "../operations/finalized-operation.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

export type RustTypeAliasDeclarationFact =
  | { readonly kind: "family" }
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

export type RustSuspendedCallableStorage =
  | { readonly kind: "static" }
  | { readonly kind: "receiver" }
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetimeRef };

export interface RustSuspendedOwnedReceiver {
  readonly carrier: TargetTypeRef;
  readonly occurrences: readonly Node[];
}

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
      readonly lowering: RustJsPromiseLowering;
    };

export interface RustSettledPromiseAwait {
  readonly expression: Node;
  readonly callee: Node;
}

export interface RustPromiseBodyDeclaration {
  readonly name: string;
  readonly visibility: "private" | "crate";
}

export interface RustPromiseBodies {
  readonly declarations: ReadonlyMap<Node, RustPromiseBodyDeclaration>;
  readonly objects: ReadonlyMap<Node, readonly Node[]>;
  readonly pinnedInvocations: ReadonlyMap<Node, ReadonlyMap<string, ReadonlySet<Node>>>;
}

export type RustJsPromiseLowering =
  | {
      readonly kind: "settled";
      readonly settledAwaits: readonly RustSettledPromiseAwait[];
    }
  | {
      readonly kind: "factory";
      readonly storage: RustSuspendedCallableStorage;
      readonly capturedParameters: readonly Node[];
      readonly capturedCarriers: readonly TargetTypeRef[];
      readonly ownedReceiver?: RustSuspendedOwnedReceiver;
    };

export interface RustGeneratorFact {
  readonly kind: "sync" | "async";
  readonly resultCarrier: TargetTypeRef;
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
  readonly capturedParameters: readonly Node[];
  readonly storage: RustSuspendedCallableStorage;
  readonly ownedReceiver?: RustSuspendedOwnedReceiver;
}

export interface RustYieldFact {
  readonly generatorDeclaration: Node;
  readonly kind: "value" | "delegate";
  readonly yieldType: TargetTypeRef;
  readonly resultType: TargetTypeRef;
  readonly delegatedCarrier?: TargetTypeRef;
}

export type RustResourceDisposalTarget =
  | {
      readonly form: "source-method";
      readonly name: string;
      readonly receiverMode: "ref" | "mut-ref";
      readonly errorBoundary: "none" | "source-program";
      readonly dispatch?: {
        readonly virtualSlot: string;
        readonly ownerCarrier: TargetTypeRef;
      };
    }
  | {
      readonly form: "provider";
      readonly abi: RustFinalizedOperationAbiFor<"method">;
      readonly receiverMode: RustArgumentMode;
    };

export interface RustResourceManagementFact {
  readonly declarationKind: "using" | "await using";
  readonly storageCarrier: TargetTypeRef;
  readonly resourceCarrier: TargetTypeRef;
  readonly nullable: boolean;
  readonly disposal: {
    readonly kind: "sync" | "async";
    readonly fallible: boolean;
    readonly target: RustResourceDisposalTarget;
  };
}

export interface RustParameterEntryConversion {
  readonly conversion: import("../../operations/model.js").RustValueConversion;
  readonly contract: import("../../conversions/contracts.js").RustValueConversionContract;
}

export interface RustSourceParameterAbiFact {
  readonly form: "required" | "optional" | "default" | "rest";
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly inputLifetime?: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
  readonly entryConversion?: RustParameterEntryConversion;
}
