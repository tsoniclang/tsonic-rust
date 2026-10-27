import type { Node } from "@tsonic/tsts";
import type { RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence } from "./physical-emission-contexts.js";
import type { RustFinalizedSourceInput } from "../operations/finalized-operation.js";
import type { SourceExpressionEffects } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustPhysicalEmissionSourceSlot } from "./physical-emission-contexts.js";

export type RustMutableProviderStorage =
  | { readonly kind: "direct" | "owned"; readonly rootDeclaration: Node | undefined }
  | { readonly kind: "project-field"; readonly rootDeclaration: Node | undefined;
      readonly receiver: Node; readonly path: readonly string[] };

export interface RustMutableProviderOperand {
  readonly key: string;
  readonly input: RustFinalizedSourceInput;
  readonly node: Node;
  readonly storage: RustMutableProviderStorage;
}

export interface RustProviderEvaluationRecords {
  readonly providerEvaluation: { readonly get: (node: Node, operation: RustEmissionProviderOperation) => RustProviderEvaluationEmission | undefined };
  readonly providerMutableOperands: { readonly get: (node: Node, operation: RustEmissionProviderOperation) => readonly RustMutableProviderOperand[] | undefined };
  readonly providerStorageEffects: { readonly get: (node: Node) => SourceExpressionEffects | undefined };
  readonly providerSourceOccurrence: {
    readonly get: (node: Node, operation: RustEmissionProviderOperation) => RustPhysicalEmissionSourceOccurrence | undefined;
  };
}

export interface RustProviderEvaluationEmission {
  readonly indexReceiverBorrow: boolean;
  readonly source: RustPhysicalEmissionSourceOccurrence;
  readonly force: ReadonlySet<string>;
  readonly orderConflicts: readonly (readonly string[])[];
  readonly effects: ReadonlySet<string>;
  readonly dispatch: boolean;
  readonly slots: readonly {
    readonly slot: RustPhysicalEmissionSourceSlot;
    readonly inputs: readonly RustFinalizedSourceInput[];
    readonly sequence: RustFinalizedSourceInput | undefined;
    readonly snapshot: boolean;
    readonly borrowedEvaluation: boolean;
    readonly borrowAcross: ReadonlySet<string>;
    readonly mutableAcross: ReadonlySet<string>;
    readonly ownerCarrier: TargetTypeRef | undefined;
  }[];
}
