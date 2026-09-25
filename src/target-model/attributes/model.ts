export type RustAttributeConstant =
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "tuple"; readonly elements: readonly RustAttributeConstant[] }
  | { readonly kind: "record"; readonly fields: readonly { readonly name: string; readonly value: RustAttributeConstant }[] };
