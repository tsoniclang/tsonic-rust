import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustObjectRepresentation } from "./object-representation.js";

export type RustIndexedRecordStorage = { readonly kind: "project-field"; readonly name: string } | { readonly kind: "record" };

export type RustIndexedRecordStorageEmission =
  | { readonly kind: "record"; readonly carrier: TargetTypeRef; readonly read: "get" | "get_or_default" }
  | { readonly kind: "project-field"; readonly carrier: TargetTypeRef; readonly name: string; readonly representation: RustObjectRepresentation };

export interface RustIndexedRecordAccessEmission {
  readonly receiver: Node;
  readonly key: { readonly kind: "literal"; readonly value: string } | { readonly kind: "expression"; readonly expression: Node };
}

export interface RustIndexedRecordRecords {
  readonly indexedRecordKey: { readonly get: (property: Node) => { readonly kind: "string" | "integer"; readonly value: string } | undefined };
  readonly indexedRecordStorage: { readonly get: (carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, storage: RustIndexedRecordStorage) => RustIndexedRecordStorageEmission | undefined };
  readonly indexedRecordAccess: { readonly get: (node: Node) => RustIndexedRecordAccessEmission | undefined };
}
