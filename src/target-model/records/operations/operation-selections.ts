import type { Node } from "@tsonic/tsts";
import type { RustProviderFactOperationKind } from "../../operations/model.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustReceiverFieldCapture } from "../callables/receiver-captures.js";
import type { RustCapturedFieldStorage } from "../../types/field-storage.js";

export interface RustComputedMemberFact {
  readonly receiver: Node;
  readonly key: Node;
  readonly evaluateReceiver: boolean;
  readonly evaluateKey: boolean;
  readonly accessMode: "read" | "write" | "read-write" | "delete";
}

export interface RustPreparedOperationResultFact {
  readonly operationId: string;
  readonly operationKind: RustProviderFactOperationKind;
  readonly resultCarrier: TargetTypeRef;
}

export interface RustBindingStorageFact {
  readonly storage: "location" | "cell" | "borrow-cell";
  readonly valueCarrier: TargetTypeRef;
  readonly initialization?: "deferred";
  readonly iterationScope?: Node;
}

export interface RustClosureCaptureFact {
  readonly receivers: readonly {
    readonly owner: Node;
    readonly reference: Node;
    readonly references: readonly Node[];
    readonly carrier: TargetTypeRef;
  }[];
  readonly receiverFields: readonly (RustReceiverFieldCapture & {
    readonly carrier: TargetTypeRef;
    readonly storage: RustCapturedFieldStorage;
  })[];
  readonly invocationOwner?: "shared-state";
  readonly captures: readonly {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location" | "cell" | "borrow-cell";
    readonly mutable?: true;
    readonly fieldName?: string;
  }[];
  readonly recursiveDeclaration?: Node;
  readonly recursiveField?: RustReceiverFieldCapture & { readonly carrier: TargetTypeRef };
}

export interface RustSourceCallableValueFact {
  readonly form: "function";
  readonly sourceDeclaration: Node;
  readonly fileName: string;
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly resultCarrier: TargetTypeRef;
}

export interface RustModuleBindingPatternStep {
  readonly declaration: Node;
  readonly source: Node;
  readonly kind: "binding" | "pattern";
  readonly initializer?: Node;
}

export type RustModuleBindingFact =
  | {
      readonly declarationKind: "const" | "let" | "var";
      readonly storage: "module-pattern";
      readonly valueCarrier: TargetTypeRef;
      readonly initializer: Node;
      readonly steps: readonly RustModuleBindingPatternStep[];
    }
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
        readonly resultCarrier: TargetTypeRef;
      };
    }
  | {
      readonly declarationKind: "const" | "let" | "var";
      readonly storage: "module-cell";
      readonly initialization: "value" | "declaration";
      readonly valueCarrier: TargetTypeRef;
    };
