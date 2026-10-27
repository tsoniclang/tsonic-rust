import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../types/model.js";
import type { RustTargetGenericBindings } from "../../types/carriers/generic-inference.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../types/carriers/callable-signatures.js";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";
import type { RustNativeCallableInput } from "../native/native-protocols.js";
import type { RustTargetOperationFact } from "../operations/operations.js";

export interface RustGenericCallablePhysicalPlan {
  definitions(): readonly RustGenericCallablePhysicalDefinition[];
  environmentFor(implementation: RustGenericCallableImplementation): RustGenericCallableEnvironment | undefined;
  definitionFor(carrier: TargetTypeRef): RustGenericCallablePhysicalDefinition | undefined;
  argumentsFor(carrier: TargetTypeRef): readonly RustTargetGenericArgument[] | undefined;
  conversionFor(source: TargetTypeRef, target: TargetTypeRef): RustGenericCallablePhysicalConversion | undefined;
  existingSelectionFor(carrier: TargetTypeRef): RustGenericCallablePhysicalSelection | undefined;
}

export interface RustGenericCallablePhysicalRecordInput {
  readonly inventory: readonly RustGenericCallablePhysicalDefinition[];
  readonly environments: ReadonlyMap<RustGenericCallableImplementation, RustGenericCallableEnvironment | undefined>;
  readonly selectedCarriers: ReadonlyMap<string, RustGenericCallablePhysicalSelection>;
  readonly conversions: ReadonlyMap<string, ReadonlyMap<string, RustGenericCallablePhysicalConversion | undefined>>;
}

export interface RustGenericCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly sourceFileName: string;
  readonly variantName: string;
  readonly stateName: string;
  readonly functionName: string;
  readonly storage: "value" | "shared";
  readonly creation: "declaration" | "activation";
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receiverFields: readonly (RustClosureCaptureFact["receiverFields"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receivers: readonly (RustClosureCaptureFact["receivers"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly substitutions: readonly (readonly [string, TargetTypeRef])[];
}

export interface RustGenericCallableDefinition {
  readonly identity: string;
  readonly origin: RustCallableOrigin;
  readonly targetName: string;
  readonly nativeFutureDispatchName?: string;
  readonly copy: boolean;
  readonly identityObserved: boolean;
  readonly ownerFileName: string;
  readonly signature: RustCallableSignature;
  readonly implementations: readonly RustGenericCallableImplementation[];
}

export interface RustGenericCallableEnvironment {
  readonly captures: RustGenericCallableImplementation["captures"];
  readonly receiverFields: RustGenericCallableImplementation["receiverFields"];
  readonly receivers: RustGenericCallableImplementation["receivers"];
  readonly parameters: readonly RustTargetGenericArgument[];
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly inputs: readonly RustNativeCallableInput[];
  readonly substitutions: RustTargetGenericBindings;
}

export interface RustGenericCallablePhysicalMember {
  readonly implementation: RustGenericCallableImplementation;
  readonly environment: RustGenericCallableEnvironment;
  readonly variantName: string;
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly bindings: RustTargetGenericBindings | undefined;
}

export interface RustGenericCallablePhysicalDefinition extends RustGenericCallableDefinition {
  readonly familyIdentity: string;
  readonly parameters: readonly RustTargetGenericArgument[];
  readonly members: readonly RustGenericCallablePhysicalMember[];
  readonly carrier: TargetTypeRef;
}

export interface RustGenericCallablePhysicalSelection {
  readonly definition: RustGenericCallablePhysicalDefinition;
  readonly arguments: readonly RustTargetGenericArgument[];
}

export type RustGenericCallablePhysicalConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "variants"; readonly members: readonly {
    readonly source: RustGenericCallablePhysicalMember;
    readonly target: RustGenericCallablePhysicalMember;
  }[] };

export interface RustGenericCallableIdentityPair {
  readonly left: RustGenericCallablePhysicalMember;
  readonly right: RustGenericCallablePhysicalMember;
  readonly kind: "declaration" | "activation";
}

export interface RustGenericCallableIdentitySelection {
  readonly leftCarrier: TargetTypeRef;
  readonly rightCarrier: TargetTypeRef;
  readonly left: RustGenericCallablePhysicalDefinition;
  readonly right: RustGenericCallablePhysicalDefinition;
  readonly pairs: readonly RustGenericCallableIdentityPair[];
  readonly exhaustive: boolean;
}

export interface RustGenericCallableIdentityComparison extends RustGenericCallableIdentitySelection {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>;
  readonly leftNode: Node;
  readonly rightNode: Node;
}
