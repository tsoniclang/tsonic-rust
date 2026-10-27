export type RustDeadCodeDisposition =
  | "authored-declaration"
  | "authored-unread-field"
  | "authored-unused-variant"
  | "generated-enum-discriminant"
  | "generated-retained-constructor"
  | "generated-unconstructed-instance"
  | "generated-unconstructed-shape"
  | "generated-unconstructed-variant"
  | "generated-unused-dispatch"
  | "generated-unused-storage";

export interface RustStructuralLivenessEmission {
  readonly deadCode: RustDeadCodeDisposition | undefined;
  readonly variants: ReadonlyMap<string, RustDeadCodeDisposition | undefined>;
  readonly fields: ReadonlyMap<number, Readonly<Record<"value" | "getter" | "setter", RustDeadCodeDisposition | undefined>>>;
}

export interface RustLivenessEmissionRecords {
  readonly authoredLiveness: { readonly get: (node: Node) => { readonly deadCode: RustDeadCodeDisposition | undefined } | undefined };
  readonly structuralLiveness: { readonly get: (carriers: readonly import("../../types/model.js").TargetTypeRef[],
    publiclyReachable: boolean) => RustStructuralLivenessEmission | undefined };
}

export interface RustNativeDeclarationLiveness {
  readonly visibility: "public" | "crate";
  readonly deadCode: RustDeadCodeDisposition | undefined;
  readonly enumDiscriminant: RustDeadCodeDisposition | undefined;
  readonly interface: {
    readonly publiclyReachable: boolean;
    readonly deadCode: RustDeadCodeDisposition | undefined;
    readonly fields: ReadonlyMap<Node, RustDeadCodeDisposition | undefined>;
    readonly indexDeadCode: RustDeadCodeDisposition | undefined;
  } | undefined;
  readonly variants: readonly {
    readonly name: string;
    readonly deadCode: RustDeadCodeDisposition | undefined;
    readonly nonUpperCaseConstant: boolean;
  }[];
}
import type { Node } from "@tsonic/tsts";

