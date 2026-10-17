import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustTargetGenericBindings } from "../types/carriers/generic-inference.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustErrorRegionSelection, RustInitializerSelection } from "./error-regions.js";
import type { RustFinalizedOperationAbi, RustFinalizedSourceArgument, RustFinalizedSourceInput } from "./finalized-operation.js";
import type { RustTargetOperationFact } from "./operations.js";

export type RustEmissionReturnDestination =
  | { readonly kind: "none" }
  | { readonly kind: "value"; readonly carrier: TargetTypeRef; readonly borrowedParameter: Node | undefined };

export type RustEmissionErrorContext =
  | { readonly kind: "none" }
  | { readonly kind: "region"; readonly owner: Node; readonly region: RustErrorRegionSelection }
  | { readonly kind: "initializer"; readonly owner: SourceFile; readonly initializer: RustInitializerSelection };

export interface RustPhysicalEmissionContext {
  readonly use: TargetUseSiteRef;
  readonly declaration: Node;
  readonly bindings: RustTargetGenericBindings;
  readonly returnDestination: RustEmissionReturnDestination;
  readonly error: RustEmissionErrorContext;
  readonly operands: readonly TargetTypeRef[];
}

export type RustEmissionProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>;

export interface RustPhysicalEmissionSourceSlot {
  readonly key: string;
  readonly node: Node;
  readonly operationNode: Node;
  readonly operation: RustEmissionProviderOperation;
  readonly source:
    | { readonly kind: "receiver"; readonly row: Extract<RustFinalizedOperationAbi["sourceReceiver"], { readonly kind: "receiver" }> }
    | { readonly kind: "argument"; readonly row: RustFinalizedSourceArgument };
  readonly evaluationOnly?: "unit" | "value";
}

export interface RustPhysicalEmissionSourceOccurrence {
  readonly node: Node;
  readonly operation: RustEmissionProviderOperation;
  readonly slots: readonly RustPhysicalEmissionSourceSlot[];
  readonly inputs: readonly { readonly input: RustFinalizedSourceInput; readonly slot: RustPhysicalEmissionSourceSlot }[];
  readonly targetOrder: readonly string[];
}

export type RustPhysicalEmissionEvaluationOrigin =
  | { readonly kind: "ordinary"; readonly site: TargetUseSiteRef }
  | { readonly kind: "provider-source"; readonly slot: RustPhysicalEmissionSourceSlot };

export type RustPhysicalEmissionOperandOrigin =
  | { readonly kind: "value" | "operand"; readonly evaluation: RustPhysicalEmissionEvaluationOrigin }
  | {
      readonly kind: "call-input";
      readonly operationNode: Node;
      readonly operation: RustEmissionProviderOperation;
      readonly input: RustFinalizedSourceInput;
    };

export interface RustPhysicalEmissionOperand {
  readonly use: TargetUseSiteRef;
  readonly node: Node;
  readonly context: RustPhysicalEmissionContext;
  readonly origin: RustPhysicalEmissionOperandOrigin;
  readonly carrier: TargetTypeRef;
  readonly destination: TargetTypeRef | undefined;
}

export interface RustCallableEmissionContexts {
  readonly contexts: readonly RustPhysicalEmissionContext[];
  readonly operands: readonly RustPhysicalEmissionOperand[];
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  contextFor(use: TargetUseSiteRef): RustPhysicalEmissionContext | undefined;
  operandFor(use: TargetUseSiteRef): RustPhysicalEmissionOperand | undefined;
  carrierFor(use: TargetUseSiteRef, source: TargetTypeRef): TargetTypeRef | undefined;
  sourceFor(node: Node, operation: RustEmissionProviderOperation): RustPhysicalEmissionSourceOccurrence | undefined;
}
