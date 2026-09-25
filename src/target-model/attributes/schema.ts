export type RustAttributePlacement = "function" | "module" | "struct" | "enum";

export type RustAttributeArgumentSchema =
  | { readonly kind: "integer" | "string" | "boolean" }
  | { readonly kind: "tuple"; readonly elements: readonly RustAttributeArgumentSchema[] }
  | {
      readonly kind: "record";
      readonly exportId: string;
      readonly fields: readonly {
        readonly memberId: string;
        readonly name: string;
        readonly optional: boolean;
        readonly schema: RustAttributeArgumentSchema;
      }[];
    };

export interface RustProviderAttributeDefinition {
  readonly exportId: string;
  readonly signatureId: string;
  readonly kind: "attribute" | "derive";
  readonly path: string;
  readonly placements: readonly RustAttributePlacement[];
  readonly arguments: readonly RustAttributeArgumentSchema[];
  readonly requiredParent?: {
    readonly exportId: string;
    readonly signatureId: string;
  };
}

export interface RustProviderAttributeRow extends RustProviderAttributeDefinition {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}
