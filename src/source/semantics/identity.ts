export const rustSourceSemanticsExtensionId = "tsonic.rust.source-semantics";
export const rustSourceVirtualModulesProviderId = "tsonic.rust.source-virtual-modules";
export const rustSourceProviderVersion = "0.0.1";

export const rustTypesModule = "@tsonic/rust/types.js";
export const rustLangModule = "@tsonic/rust/lang.js";
export const rustSourceNativeUintExportId = "usize";

export const rustSourceTypeExportIds = Object.freeze({
  life: "Life",
  staticLifetime: "Static",
  owned: "Owned",
  sharedReference: "Ref",
  mutableReference: "Mut",
  outlives: "Outlives",
  validFor: "ValidFor",
  constParameter: "Const",
  dynamicTrait: "Dyn",
  captureSet: "Capture",
  opaqueType: "Impl",
  maybeSized: "MaybeSized",
  functionPointer: "FnPtr",
  rustChar: "char",
  constPointer: "constPtr",
  mutablePointer: "mutPtr",
} as const);

export const rustSourceOperationExportIds = Object.freeze({
  sharedBorrow: "ref",
  mutableBorrow: "mut",
  move: "move",
  clone: "clone",
  own: "own",
  load: "load",
  store: "store",
  replace: "replace",
  take: "take",
  captureMove: "captureMove",
  declaration: "rust",
  exposePointerAddress: "exposePointerAddress",
  constPointerFromExposedAddress: "constPointerFromExposedAddress",
  mutablePointerFromExposedAddress: "mutPointerFromExposedAddress",
  readVolatile: "readVolatile",
  writeVolatile: "writeVolatile",
} as const);

export const rustSourceOperationSignatureIds = Object.freeze({
  sharedBorrow: "ref<T>(value)",
  mutableBorrow: "mut<T>(value)",
  move: "move<T>(value)",
  clone: "clone<T>(value)",
  own: "own<T>(reference)",
  loadShared: "load<T>(reference)",
  loadMutable: "load<T>(mutableReference)",
  store: "store<T>(reference,value)",
  replace: "replace<T>(reference,value)",
  take: "take<T>(reference)",
  captureMove: "captureMove<F>(callback)",
  declarationValue: "rust<T>(value)",
  declarationType: "rust<T>()",
  exposeConstPointerAddress: "exposePointerAddress<T>(constPointer)",
  exposeMutablePointerAddress: "exposePointerAddress<T>(mutablePointer)",
  constPointerFromExposedAddress: "constPointerFromExposedAddress<T>(address)",
  mutablePointerFromExposedAddress: "mutPointerFromExposedAddress<T>(address)",
  readVolatile: "readVolatile<T>(pointer)",
  writeVolatile: "writeVolatile<T>(pointer,value)",
} as const);

export const rustDeclarationBuilderExportId = "RustDeclarationBuilder";

export const rustDeclarationBuilderMemberIds = Object.freeze({
  extern: "RustDeclarationBuilder.extern",
  variadic: "RustDeclarationBuilder.variadic",
  reprC: "RustDeclarationBuilder.reprC",
  reprTransparent: "RustDeclarationBuilder.reprTransparent",
  reprPacked: "RustDeclarationBuilder.reprPacked",
  reprAlign: "RustDeclarationBuilder.reprAlign",
  union: "RustDeclarationBuilder.union",
  mutableStatic: "RustDeclarationBuilder.mutableStatic",
  threadLocal: "RustDeclarationBuilder.threadLocal",
  unsafeTrait: "RustDeclarationBuilder.unsafeTrait",
  unsafeImpl: "RustDeclarationBuilder.unsafeImpl",
  negativeImpl: "RustDeclarationBuilder.negativeImpl",
  drop: "RustDeclarationBuilder.drop",
} as const);

export const rustDeclarationBuilderSignatureIds = Object.freeze(
  Object.fromEntries(
    Object.entries(rustDeclarationBuilderMemberIds).map(([name, id]) => [name, `${id}()`]),
  ) as Readonly<Record<keyof typeof rustDeclarationBuilderMemberIds, string>>,
);
