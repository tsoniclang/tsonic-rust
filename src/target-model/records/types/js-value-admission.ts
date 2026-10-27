export type RustTsValueAdmission =
  | { readonly kind: "call"; readonly path: string }
  | { readonly kind: "project-object" };
