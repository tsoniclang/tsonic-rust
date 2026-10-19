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

export interface RustNativeDeclarationLiveness {
  readonly visibility: "public" | "crate";
  readonly deadCode: RustDeadCodeDisposition | undefined;
  readonly enumDiscriminant: RustDeadCodeDisposition | undefined;
  readonly variants: readonly {
    readonly name: string;
    readonly deadCode: RustDeadCodeDisposition | undefined;
    readonly nonUpperCaseConstant: boolean;
  }[];
}
