export interface RustSignatureVisibility {
  readonly requiredByModule: ReadonlyMap<string, ReadonlySet<string>>;
  readonly structuralShapes: ReadonlySet<string>;
}

export interface RustSignatureVisibilityRecords {
  readonly signatureVisibility: { readonly get: (componentId: string) => RustSignatureVisibility | undefined };
}
