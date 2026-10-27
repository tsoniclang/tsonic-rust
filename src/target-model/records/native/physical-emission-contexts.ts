import type { Node, SourceFile } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageBoundActivation, SourceStorageConstructionSelection, SourceStorageDomainBoundary, SourceStorageProducer, SourceStorageSubject, TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustTargetGenericBindings } from "../../types/carriers/generic-inference.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustErrorRegionSelection, RustInitializerSelection, RustModuleErrorInitializer } from "../errors/error-regions.js";
import type { RustFinalizedOperationAbi, RustFinalizedSourceArgument, RustFinalizedSourceInput } from "../operations/finalized-operation.js";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustPhysicalCallableSourceActivations =
  | { readonly kind: "resolved"; readonly rows: readonly {
      readonly activation: SourceStorageBoundActivation;
      readonly targetBindings: RustTargetGenericBindings;
    }[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustPhysicalCallableSourceProducer {
  readonly producer: SourceStorageProducer;
  readonly member: object;
}

export type RustPhysicalCallableSourceSelection =
  | { readonly kind: "complete"; readonly subject: SourceStorageSubject; readonly bindings: SourceStorageBindings;
      readonly producers: readonly RustPhysicalCallableSourceProducer[] }
  | { readonly kind: "open"; readonly subject: SourceStorageSubject; readonly bindings: SourceStorageBindings;
      readonly producers: readonly RustPhysicalCallableSourceProducer[]; readonly boundaries: readonly SourceStorageDomainBoundary[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export type RustPhysicalEmissionSourceOrigin =
  | { readonly kind: "callable"; readonly producer: SourceStorageProducer; readonly member: object;
      readonly execution: SourceStorageProducer; readonly activation: SourceStorageBoundActivation;
      readonly targetBindings: RustTargetGenericBindings }
  | { readonly kind: "declaration";
      readonly activation: Extract<SourceStorageBoundActivation, { readonly kind: "declaration" }>;
      readonly targetBindings: RustTargetGenericBindings }
  | { readonly kind: "construction"; readonly invocation: Node;
      readonly construction: Extract<SourceStorageConstructionSelection, { readonly kind: "resolved" }>["alternatives"][number];
      readonly root: Extract<SourceStorageConstructionSelection, { readonly kind: "resolved" }>["alternatives"][number];
      readonly callerBindings: SourceStorageBindings; readonly caller: RustPhysicalEmissionSourceOrigin;
      readonly owner: Node; readonly region: Node;
      readonly selection: Extract<SourceStorageBindingsSelection, { readonly kind: "resolved" }>;
      readonly activation: SourceStorageBoundActivation;
      readonly targetBindings: RustTargetGenericBindings }
  | { readonly kind: "module"; readonly sourceFile: SourceFile; readonly initializer: RustInitializerSelection;
      readonly module: RustModuleErrorInitializer; readonly region: Node;
      readonly selection: Extract<SourceStorageBindingsSelection, { readonly kind: "resolved" }>;
      readonly targetBindings: RustTargetGenericBindings };

export type RustPhysicalEmissionSourceOrigins = {
  readonly use: TargetUseSiteRef;
  readonly occurrence: RustPhysicalEmissionSourceOccurrence;
} & (
  | { readonly kind: "resolved"; readonly subject: SourceStorageSubject;
      readonly alternatives: readonly RustPhysicalEmissionSourceOrigin[] }
  | { readonly kind: "open"; readonly subject: SourceStorageSubject;
      readonly alternatives: readonly RustPhysicalEmissionSourceOrigin[]; readonly boundaries: readonly SourceStorageDomainBoundary[] }
  | { readonly kind: "unavailable"; readonly reason: string }
);

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
  readonly sourceOrigins: readonly RustPhysicalEmissionSourceOrigins[];
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
  readonly receiverProjection:
    | { readonly kind: "source" }
    | { readonly kind: "union-payload";
        readonly union: Extract<RustTargetOperationFact, { readonly kind: "union-property" }>;
        readonly variant: Extract<RustTargetOperationFact, { readonly kind: "union-property" }>["variants"][number] };
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
  sourceOriginFor(use: TargetUseSiteRef, occurrence: RustPhysicalEmissionSourceOccurrence): RustPhysicalEmissionSourceOrigins | undefined;
}
