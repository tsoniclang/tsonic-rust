import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";

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
  readonly typeParameters: readonly string[];
  readonly returnCarrier: TargetTypeRef;
  readonly omitReturn: boolean;
  readonly fallible: boolean;
  readonly errorCarrier: TargetTypeRef | undefined;
  readonly safety: Readonly<Record<"declaration" | "getter" | "setter", boolean>>;
}

export interface RustProjectClassRecords {
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
