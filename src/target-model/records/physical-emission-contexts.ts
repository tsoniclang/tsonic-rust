import type { Node, SourceFile } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageBoundActivation,
  SourceStorageConstructionSelection, SourceStorageDomainBoundary, SourceStorageProducer,
  SourceStorageSubject, TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustTargetGenericBindings } from "../types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../types/model.js";
import type { RustErrorRegionSelection, RustInitializerSelection, RustModuleErrorInitializer } from "./error-regions.js";
import type { RustFinalizedOperationAbi, RustFinalizedSourceArgument, RustFinalizedSourceInput } from "./finalized-operation.js";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustNativeErrorSource } from "../types/native-error-joins.js";
import type { RustSourceErrorEffectEdge } from "./source-error-effects.js";
import type { RustSourceErrorRegionSelection } from "./error-regions.js";
import type { RustCallablePhysicalAdapter } from "./callable-adapters.js";
import type { RustGenericCallableInvocationFact } from "./generic-callable-effects.js";
import type { RustNativeMemoryLayout } from "../operations/native-memory.js";
import type { RustNativeClassField } from "./native-value-declarations.js";

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
  | { readonly kind: "module"; readonly sourceFile: SourceFile; readonly initializer: RustInitializerSelection<RustNativeErrorSource<TargetTypeRef>>;
      readonly module: RustModuleErrorInitializer<RustNativeErrorSource<TargetTypeRef>>; readonly region: Node;
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
  | { readonly kind: "unavailable"; readonly reason: string;
      readonly alternatives: readonly RustPhysicalEmissionSourceOrigin[]; readonly boundaries: readonly SourceStorageDomainBoundary[] }
);

export type RustEmissionReturnDestination =
  | { readonly kind: "none" }
  | { readonly kind: "value"; readonly carrier: TargetTypeRef; readonly borrowedParameter: Node | undefined };

export type RustEmissionErrorContext<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> =
  | { readonly kind: "none" }
  | { readonly kind: "region"; readonly owner: Node; readonly region: RustErrorRegionSelection<Source> }
  | { readonly kind: "initializer"; readonly owner: SourceFile; readonly initializer: RustInitializerSelection<Source> };

export type RustPhysicalTargetGenericArgument =
  | Extract<RustTargetGenericArgument, { readonly kind: "const" }>
  | { readonly kind: "type"; readonly nativeCarrier: TargetTypeRef }
  | { readonly kind: "infer" };

export interface RustNativeBindingStorage {
  readonly kind: "value" | "cell" | "borrow-cell" | "location" | "module-cell";
  readonly initialization: "ready" | "deferred";
  readonly payloadCarrier: TargetTypeRef;
  readonly valueCarrier: TargetTypeRef;
  readonly slotCarrier: TargetTypeRef;
  readonly holderCarrier: TargetTypeRef;
  readonly valueConstructor: string | null;
  readonly slotConstructor: string | null;
  readonly deferredConstructor: string | null;
  readonly ownerConstructor: string | null;
  readonly nativeAllocation: RustNativeMemoryLayout | null;
  readonly requirements: readonly ("copy" | "clone" | "static")[];
}

export interface RustNativeStorageBindingRequest {
  readonly use: TargetUseSiteRef;
  readonly declaration: Node;
  readonly logicalCarrier: TargetTypeRef;
  readonly physicalCarrier: TargetTypeRef;
  readonly sourceBindings: RustTargetGenericBindings;
  readonly source:
    | { readonly kind: "binding" }
    | { readonly kind: "capture"; readonly reference: Node;
        readonly storage: "value" | "location" | "cell" | "borrow-cell";
        readonly initialization: "ready" | "deferred" }
    | { readonly kind: "module"; readonly sourceFile: SourceFile; readonly initialization: "ready" | "deferred" }
    | { readonly kind: "field"; readonly definingOwner: Node; readonly storageIndex: number;
        readonly targetName: string; readonly storage: RustNativeClassField["storage"] };
}

export interface RustNativeStorageBinding extends RustNativeStorageBindingRequest {
  readonly contextUse: TargetUseSiteRef;
  readonly storage: RustNativeBindingStorage;
  readonly readCarrier: TargetTypeRef;
  readonly owner:
    | { readonly kind: "binding"; readonly declaration: Node }
    | { readonly kind: "module"; readonly sourceFile: SourceFile }
    | RustNativeFrameStorageOwner
    | { readonly kind: "field"; readonly declaration: Node; readonly definingOwner: Node;
        readonly storageIndex: number; readonly targetName: string };
}

export interface RustNativeFrameStorageOwner {
  readonly kind: "frame";
  readonly declaration: Node;
  readonly fieldName: string;
  readonly frameCarrier: TargetTypeRef;
  readonly holderCarrier: TargetTypeRef;
  readonly constructor: string | null;
}

export interface RustNativeFrameBindingStorageCompletion {
  readonly storage: RustNativeBindingStorage;
  readonly readCarrier: TargetTypeRef;
  readonly owner: RustNativeFrameStorageOwner;
}

export type RustPhysicalEmissionRole =
  | "native-body" | "specialized-body" | "project-body"
  | "helper" | "body" | "member" | "native-input" | "native-backing" | "frame"
  | "constructor" | "constructor-layer" | "module-initializer" | "worker-initializer";

export type RustEmissionCallableSpecialization =
  | { readonly kind: "ordinary" }
  | { readonly kind: "finite"; readonly typeParameterIdentities: readonly string[] };

export interface RustPhysicalEmissionContext {
  readonly use: TargetUseSiteRef;
  readonly role: RustPhysicalEmissionRole;
  readonly specialization: RustEmissionCallableSpecialization;
  readonly declaration: Node;
  readonly bindings: RustTargetGenericBindings;
  readonly returnDestination: RustEmissionReturnDestination;
  readonly error: RustEmissionErrorContext;
  readonly operands: readonly TargetTypeRef[];
  readonly nativeBindings: readonly RustNativeStorageBinding[];
  readonly sourceOrigins: readonly RustPhysicalEmissionSourceOrigins[];
  readonly callableAdapters: readonly RustCallablePhysicalAdapter<RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }>[];
  readonly targetGenericArguments: ReadonlyMap<RustFinalizedOperationAbi, readonly RustPhysicalTargetGenericArgument[]>;
  readonly frameEntries: readonly { readonly entry: object; readonly parameters: readonly TargetTypeRef[];
    readonly result: TargetTypeRef; readonly error: TargetTypeRef }[];
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
  readonly sourceErrorRegions: readonly {
    readonly edge: RustSourceErrorEffectEdge;
    readonly selection: RustSourceErrorRegionSelection;
  }[];
  readonly genericInvocation: RustGenericCallableInvocationFact<RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> | undefined;
}

export interface RustCallableEmissionContexts {
  readonly contexts: readonly RustPhysicalEmissionContext[];
  readonly operands: readonly RustPhysicalEmissionOperand[];
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  contextFor(use: TargetUseSiteRef): RustPhysicalEmissionContext | undefined;
  contextForOwner(subject: object, role: RustPhysicalEmissionRole): RustPhysicalEmissionContext | undefined;
  bodyContextFor(enclosingUse: TargetUseSiteRef, declaration: Node): RustPhysicalEmissionContext | undefined;
  operandFor(use: TargetUseSiteRef): RustPhysicalEmissionOperand | undefined;
  sourceErrorOperandFor(context: TargetUseSiteRef, node: Node): RustPhysicalEmissionOperand | undefined;
  carrierFor(use: TargetUseSiteRef, source: TargetTypeRef): TargetTypeRef | undefined;
  sourceFor(node: Node, operation: RustEmissionProviderOperation): RustPhysicalEmissionSourceOccurrence | undefined;
  sourceOriginFor(use: TargetUseSiteRef, occurrence: RustPhysicalEmissionSourceOccurrence): RustPhysicalEmissionSourceOrigins | undefined;
}
