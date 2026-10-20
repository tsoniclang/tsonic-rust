import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustStructuralShapeDefinition, RustStructuralShapeField } from "./structural-shapes.js";

export type RustRecordLiteralFact = Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>;

export interface RustStructuralLiteralFieldEmission {
  readonly field: RustStructuralShapeField;
  readonly copy: boolean;
  readonly frozen: boolean;
  readonly method: { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly storage: TargetTypeRef } | undefined;
  readonly accessor: { readonly getter: TargetTypeRef; readonly setter: TargetTypeRef | undefined } | undefined;
}

export interface RustStructuralLiteralEmission {
  readonly carrier: TargetTypeRef;
  readonly shape: RustStructuralShapeDefinition;
  readonly fields: readonly RustStructuralLiteralFieldEmission[];
}

export type RustObjectLiteralEmission =
  | { readonly kind: "project"; readonly node: Node; readonly fact: RustRecordLiteralFact }
  | { readonly kind: "structural"; readonly node: Node; readonly selection: RustStructuralLiteralEmission };

export type RustObjectLiteralEmissionRequest = RustObjectLiteralEmission |
  { readonly kind: "reference"; readonly node: Node; readonly selection: RustStructuralLiteralEmission };

export interface RustObjectLiteralEmissionRecords {
  readonly objectLiteralEmission: { readonly get: (node: Node) => RustObjectLiteralEmission | undefined };
  readonly objectLiteralEmissions: { readonly get: (file: SourceFile) => readonly RustObjectLiteralEmissionRequest[] | undefined };
}
