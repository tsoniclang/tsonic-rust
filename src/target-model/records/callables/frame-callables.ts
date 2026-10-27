import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../types/carriers/callable-signatures.js";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";
import type { RustCallableActivation } from "./callable-ownership.js";
import type { RustSourceCallableSpecializationIssue } from "./callable-issues.js";
import type { RustFrameInputAdmission } from "./frame-emission.js";
import type { RustErrorRegionSelection, RustSourceErrorRegionSelection } from "../errors/error-regions.js";

export type RustFrameImplementationErrorSelection =
  | { readonly kind: "infallible" | "identity" }
  | { readonly kind: "mapped"; readonly transport: RustSourceErrorRegionSelection };

export interface RustFrameEntryErrorSelection {
  readonly carrier: TargetTypeRef;
  readonly region: RustErrorRegionSelection;
  readonly implementations: ReadonlyMap<RustFrameCallableImplementation, RustFrameImplementationErrorSelection>;
}

export interface RustFrameCallablePlan {
  readonly activationInputs: ReadonlyMap<Node, ReadonlyMap<RustFrameCallableDefinition, RustFrameInputAdmission>>;
  readonly receiverOwners: ReadonlyMap<Node, Node>;
  readonly definitions: readonly RustFrameCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  definitionFor(carrier: TargetTypeRef): RustFrameCallableDefinition | undefined;
  definitionForOwner(declaration: Node): RustFrameCallableDefinition | undefined;
  entryFor(carrier: TargetTypeRef): RustFrameCallableEntryDefinition | undefined;
  entryErrors(entry: RustFrameCallableEntryDefinition): RustFrameEntryErrorSelection;
  errorFor(carrier: TargetTypeRef): TargetTypeRef | undefined;
  independentCarrierFor(carrier: TargetTypeRef): TargetTypeRef | undefined;
  implementationFor(declaration: Node): RustFrameCallableImplementation | undefined;
  bindingFor(declaration: Node): RustFrameCallableBinding | undefined;
  isSameActivationInput(expression: Node, definition: RustFrameCallableDefinition, receiver?: Node): boolean;
  counterNameFor(definition: RustFrameCallableDefinition): string | undefined;
}

export interface RustFrameCallableRecordInput {
  readonly entryErrors: (entry: RustFrameCallableEntryDefinition) => RustFrameEntryErrorSelection;
  readonly errorFor: (carrier: TargetTypeRef) => TargetTypeRef | undefined;
  readonly independentCarrierFor: (carrier: TargetTypeRef) => TargetTypeRef | undefined;
  readonly entryFor: (carrier: TargetTypeRef) => RustFrameCallableEntryDefinition | undefined;
  readonly definitions: readonly RustFrameCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  readonly activationInputs: ReadonlyMap<Node, ReadonlyMap<RustFrameCallableDefinition, RustFrameInputAdmission>>;
  readonly receiverOwners: ReadonlyMap<Node, Node>;
  readonly selectedDefinitions: ReadonlyMap<string, RustFrameCallableDefinition>;
  readonly byDeclaration: ReadonlyMap<Node, RustFrameCallableDefinition>;
  readonly implementations: ReadonlyMap<Node, RustFrameCallableImplementation>;
  readonly bindings: ReadonlyMap<Node, RustFrameCallableBinding>;
}

export interface RustFrameCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly capture: RustClosureCaptureFact;
  readonly variantName: string;
  readonly functionName: string;
  readonly stateName: string;
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receiverFields: readonly (RustClosureCaptureFact["receiverFields"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receivers: readonly (RustClosureCaptureFact["receivers"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly copy: boolean;
  readonly independent: boolean;
}

export interface RustFrameCallableEntryDefinition {
  readonly key: string;
  readonly targetName: string;
  readonly signature: RustCallableSignature;
  readonly implementations: readonly RustFrameCallableImplementation[];
  readonly copy: boolean;
  readonly environmentIndexes: readonly number[];
  readonly hasIndependent: boolean;
}

export interface RustFrameCallableBinding {
  readonly declaration: Node;
  readonly fieldName: string;
  readonly carrier: TargetTypeRef;
  readonly entry: RustFrameCallableEntryDefinition | undefined;
  readonly initialization: "ready" | "deferred";
  readonly storage: "value" | "location" | "cell" | "borrow-cell";
}

export interface RustFrameCallableDefinition {
  readonly activation: RustCallableActivation;
  readonly owner: RustCallableOrigin;
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly counterName: string;
  readonly storage: { readonly kind: "standalone"; readonly instanceFieldName?: string }
    | { readonly kind: "object"; readonly mutable: boolean };
  readonly entries: readonly RustFrameCallableEntryDefinition[];
  readonly bindings: readonly RustFrameCallableBinding[];
  readonly environmentParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly constructionExposure?: { readonly declaration: Node; readonly expression: Node };
}
