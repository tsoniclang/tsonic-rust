import type { Node } from "@tsonic/tsts";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition, RustProjectInstanceContract } from "../../types/project-types.js";
import type { RustProjectCallableAdapter } from "../callables/project-callable-adapters.js";
import type { RustProjectDowncastRoute } from "../../types/project-types.js";
import type { RustProjectMethodDispatchVariant } from "../operations/method-dispatch.js";
import type { RustProjectFieldImplementation, RustProjectFieldDispatchPlan } from "../storage/field-writes.js";
import type { RustDeadCodeDisposition } from "../native/native-liveness.js";
import type { RustObjectRepresentation } from "./object-representation.js";
import type { RustNamedClassEnvironment } from "./class-values.js";
import type { SourceCallableSourceContract } from "../callables/source-callable-contract.js";

export type RustProjectCallableAdapterIndex = ReadonlyMap<Node, ReadonlyMap<Node, ReadonlyMap<string, RustProjectCallableAdapter>>>;

export interface RustProjectFieldEmission {
  readonly storage: "stored" | "receiver-alias";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly origin: "project" | "external";
  readonly readonly: boolean;
  readonly initializer: Node | undefined;
}

export interface RustProjectMethodPropertyEmission {
  readonly declaration: Node;
  readonly owner: RustProjectTypeDefinition;
  readonly ownerCarrier: TargetTypeRef;
  readonly targetName: string;
}

export interface RustProjectClassStateEmission {
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly fields: readonly RustProjectFieldEmission[];
  readonly methodProperties: readonly RustProjectMethodPropertyEmission[];
}

export interface RustProjectCallableSignature {
  readonly contract: SourceCallableSourceContract;
  readonly typeParameters: readonly string[];
  readonly returnCarrier: TargetTypeRef;
  readonly omitReturn: boolean;
  readonly fallible: boolean;
  readonly errorCarrier: TargetTypeRef | undefined;
  readonly safety: Readonly<Record<"declaration" | "getter" | "setter", boolean>>;
}

export interface RustProjectClassRecords {
  readonly projectPolymorphicEmission: { readonly get: (declaration: Node) => RustProjectPolymorphicEmission | undefined };
  readonly projectDispatchEmission: { readonly get: (definition: RustProjectTypeDefinition) => RustProjectDispatchEmission | undefined };
  readonly projectRootEmission: { readonly get: (carrier: TargetTypeRef) => RustProjectRootEmission | undefined };
  readonly projectRelationship: { readonly get: (receiver: TargetTypeRef, owner: RustProjectTypeDefinition) => TargetTypeRef | undefined };
  readonly projectMethodArguments: { readonly get: (member: Node, arguments_: readonly TargetTypeRef[], receiver: TargetTypeRef) => readonly TargetTypeRef[] | undefined };
  readonly projectThisReferences: { readonly get: (method: Node) => ReadonlyMap<Node, readonly Node[]> | undefined };
  readonly projectForwarder: { readonly get: (contract: Node, implementation: Node) => "adapter" | "direct" | undefined };
  readonly projectCallableAdapter: { readonly get: (concrete: Node, contract: Node, implementation: Node, slot: string) => RustProjectCallableAdapter | undefined };
  readonly projectInstanceContracts: { readonly get: (carrier: TargetTypeRef) => readonly RustProjectInstanceContract[] | undefined };
  readonly receiverAlias: { readonly get: (source: TargetTypeRef, target: TargetTypeRef) => { readonly same: boolean; readonly polymorphic: boolean } | undefined };
  readonly projectClassMembers: { readonly get: (definition: RustProjectTypeDefinition) => readonly Node[] | undefined };
  readonly projectClassAccessors: { readonly get: (definition: RustProjectTypeDefinition) => readonly { readonly declaration: Node; readonly role: "read" | "write" }[] | undefined };
  readonly projectClassFields: { readonly get: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => readonly RustProjectFieldEmission[] | undefined };
  readonly projectMethodProperties: { readonly get: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => readonly RustProjectMethodPropertyEmission[] | undefined };
  readonly projectClassState: { readonly get: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => readonly RustProjectClassStateEmission[] | undefined };
  readonly projectFieldStoragePath: { readonly get: (definition: RustProjectTypeDefinition, member: Node) => readonly string[] | undefined };
  readonly projectMethodPropertyPath: { readonly get: (definition: RustProjectTypeDefinition, member: Node) => readonly string[] | undefined };
  readonly projectMemberImplementation: { readonly get: (definition: RustProjectTypeDefinition, member: Node) => Node | undefined };
  readonly projectCallableSignature: { readonly get: (member: Node) => RustProjectCallableSignature | undefined };
}

export interface RustProjectRootFieldEmission {
  readonly private: boolean;
  readonly implementation: RustProjectFieldImplementation;
  readonly dispatch: RustProjectFieldDispatchPlan;
  readonly read: string;
  readonly write: string | undefined;
  readonly capture: string | undefined;
  readonly contentMutation: boolean;
  readonly readWrap: boolean;
  readonly writeWrap: boolean;
}

export interface RustProjectRootMethodEmission {
  readonly member: Node;
  readonly variant: RustProjectMethodDispatchVariant;
  readonly virtual: { readonly declaration: Node; readonly variant: RustProjectMethodDispatchVariant };
  readonly exact: { readonly declaration: Node; readonly variant: RustProjectMethodDispatchVariant } | undefined;
  readonly overridePath: readonly string[] | undefined;
  readonly write: { readonly slot: string; readonly path: readonly string[]; readonly property: RustProjectMethodPropertyEmission } | undefined;
}

export interface RustProjectRootContractEmission {
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly projectionSlot: string | undefined;
  readonly routes: readonly RustProjectDowncastRoute[];
  readonly fields: ReadonlyMap<Node, RustProjectRootFieldEmission>;
  readonly accessors: readonly { readonly declaration: Node; readonly role: "read" | "write"; readonly implementation: Node; readonly slot: string }[];
  readonly methods: readonly RustProjectRootMethodEmission[];
}

export interface RustProjectRootEmission {
  readonly projections: readonly TargetTypeRef[];
  readonly contracts: readonly RustProjectRootContractEmission[];
}

export interface RustProjectDispatchEmission {
  readonly publiclyReachable: boolean;
  readonly deadCode: RustDeadCodeDisposition | undefined;
  readonly projection: { readonly slot: string; readonly deadCode: RustDeadCodeDisposition | undefined } | undefined;
  readonly routes: readonly { readonly route: RustProjectDowncastRoute; readonly deadCode: RustDeadCodeDisposition | undefined }[];
  readonly fields: ReadonlyMap<Node, {
    readonly dispatch: RustProjectFieldDispatchPlan;
    readonly read: string;
    readonly write: string | undefined;
    readonly capture: string | undefined;
    readonly contentMutation: boolean;
    readonly deadCode: Readonly<Record<"read" | "write" | "capture" | "content", RustDeadCodeDisposition | undefined>>;
  }>;
  readonly accessors: readonly { readonly declaration: Node; readonly role: "read" | "write"; readonly slot: string; readonly deadCode: RustDeadCodeDisposition | undefined }[];
  readonly methods: readonly { readonly declaration: Node; readonly variant: RustProjectMethodDispatchVariant; readonly exact: boolean;
    readonly virtualDeadCode: RustDeadCodeDisposition | undefined; readonly exactDeadCode: RustDeadCodeDisposition | undefined }[];
  readonly methodWrites: readonly { readonly property: RustProjectMethodPropertyEmission; readonly slot: string; readonly deadCode: RustDeadCodeDisposition | undefined }[];
  readonly projectSupers: readonly TargetTypeRef[];
  readonly structuralSupers: readonly { readonly carrier: TargetTypeRef; readonly genericArguments: readonly RustTargetGenericArgument[] }[];
}

export interface RustProjectPolymorphicEmission {
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly representation: RustObjectRepresentation;
  readonly programError: boolean;
  readonly publiclyReachable: boolean;
  readonly visibility: "public" | "crate";
  readonly wrapperDeadCode: RustDeadCodeDisposition | undefined;
  readonly baseStateDeadCode: RustDeadCodeDisposition | undefined;
  readonly rootStateDeadCode: RustDeadCodeDisposition | undefined;
  readonly environment: RustNamedClassEnvironment | undefined;
}
