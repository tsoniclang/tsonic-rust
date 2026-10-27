import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "../operations/operations.js";
import type { RustStructuralShapeDefinition, RustStructuralShapeField, RustStructuralMethodPayload } from "./structural-shapes.js";
import type { RustProjectTypeDefinition, RustProjectInstanceContract } from "../../types/project-types.js";
import type { RustProjectMethodDispatchVariant } from "../operations/method-dispatch.js";
import type { RustObjectLiteralMethodAdapterFact } from "./object-methods.js";

export type RustRecordLiteralFact = Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>;

export interface RustStructuralLiteralFieldEmission {
  readonly field: RustStructuralShapeField;
  readonly copy: boolean;
  readonly frozen: boolean;
  readonly method: ({ readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly storage: TargetTypeRef } & (
    | { readonly kind: "fixed"; readonly declaration: Node; readonly payload: RustStructuralMethodPayload }
    | { readonly kind: "stored" }
  )) | undefined;
  readonly accessor: { readonly getter: TargetTypeRef; readonly setter: TargetTypeRef | undefined } | undefined;
}

export interface RustStructuralLiteralEmission {
  readonly carrier: TargetTypeRef;
  readonly shape: RustStructuralShapeDefinition;
  readonly fields: readonly RustStructuralLiteralFieldEmission[];
}

export interface RustObjectLiteralEmission {
  readonly node: Node;
  readonly carrier: TargetTypeRef;
  readonly sourceFields: readonly { readonly storageIndex: number; readonly value: Node | undefined }[];
  readonly implementation:
    | { readonly kind: "project"; readonly selection: RustProjectLiteralEmission }
    | { readonly kind: "structural"; readonly selection: RustStructuralLiteralEmission }
    | undefined;
}

export type RustObjectLiteralEmissionRequest =
  (NonNullable<RustObjectLiteralEmission["implementation"]> & { readonly node: Node }) |
  { readonly kind: "reference"; readonly node: Node; readonly selection: RustStructuralLiteralEmission };

export interface RustObjectLiteralEmissionRecords {
  readonly closedRecord: { readonly get: (node: Node) => Extract<RustTargetOperationFact, { readonly kind: "closed-record-literal" }> | undefined };
  readonly objectLiteralEmission: { readonly get: (node: Node) => RustObjectLiteralEmission | undefined };
  readonly objectLiteralEmissions: { readonly get: (file: SourceFile) => readonly RustObjectLiteralEmissionRequest[] | undefined };
}

export type RustProjectLiteralImplementation = {
  readonly kind: "authored";
  readonly propertyIdentity: Node;
  readonly sourceCallable: Node;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly error: TargetTypeRef | undefined;
  readonly substitutions: readonly (readonly [string, TargetTypeRef])[];
} | {
  readonly kind: "spread";
  readonly propertyIdentity: Node;
  readonly contractMethod: Node;
  readonly carrier: TargetTypeRef;
  readonly parameterCount: number;
  readonly error: TargetTypeRef;
};

export interface RustProjectLiteralMethodEmission {
  readonly contractMethod: Node;
  readonly owner: RustProjectTypeDefinition;
  readonly ownerCarrier: TargetTypeRef;
  readonly variant: RustProjectMethodDispatchVariant;
  readonly implementationIndex: number;
  readonly adapter: RustObjectLiteralMethodAdapterFact["dispatches"][number] | undefined;
  readonly overrideIndex: number | undefined;
}

export interface RustProjectLiteralEmission {
  readonly carrier: TargetTypeRef;
  readonly definition: RustProjectTypeDefinition;
  readonly contracts: readonly RustProjectInstanceContract[];
  readonly fields: readonly { readonly declaration: Node; readonly contracts: readonly Node[]; readonly storageIndex: number;
    readonly preferredName: string; readonly carrier: TargetTypeRef }[];
  readonly accessors: readonly { readonly storageIndex: number; readonly contracts: readonly Node[];
    readonly carrier: TargetTypeRef; readonly error: TargetTypeRef; readonly setter: boolean }[];
  readonly implementations: readonly RustProjectLiteralImplementation[];
  readonly methods: readonly RustProjectLiteralMethodEmission[];
  readonly overrides: readonly number[];
  readonly stateUsed: boolean;
}
