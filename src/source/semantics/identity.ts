export const rustSourceSemanticsExtensionId = "tsonic.rust.source-semantics";
export const rustSourceVirtualModulesProviderId = "tsonic.rust.source-virtual-modules";
export const rustSourceProviderVersion = "0.0.1";

export const rustTypesModule = "@tsonic/rust/types.js";
export const rustLangModule = "@tsonic/rust/lang.js";
export const rustConstPointerExport = "constPtr";
export const rustMutPointerExport = "mutPtr";

export const rustSourceTypeExportIds = Object.freeze({
  life: "Life",
  staticLifetime: "Static",
  placeholderLifetime: "Placeholder",
  sharedReference: "Ref",
  mutableReference: "Mut",
  outlives: "Outlives",
  validFor: "ValidFor",
  dynamicTrait: "Dyn",
  captureSet: "Capture",
  opaqueType: "Impl",
  maybeSized: "MaybeSized",
} as const);

export const rustSourceOperationExportIds = Object.freeze({
  sharedReference: "ref",
  mutableReference: "mut",
  load: "load",
  store: "store",
} as const);

export const rustSourceOperationSignatureIds = Object.freeze({
  sharedReference: "ref<T,L>(value)",
  mutableReference: "mut<T,L>(value)",
  loadShared: "load<T,L>(reference)",
  loadMutable: "load<T,L>(mutableReference)",
  store: "store<T,L>(reference,value)",
} as const);
