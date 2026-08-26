export {
  rustLifetimeKey,
  rustLifetimeName,
  rustLifetimesEqual,
  isRustLifetimeRef,
} from "./identity.js";
export type {
  RustBoundLifetimeParameterContract,
  RustLifetimeIndex,
  RustLifetimeBinder,
  RustLifetimeParameterContract,
  RustLifetimeRef,
  RustSourceGenericContract,
  RustSourceGenericParameterContract,
  RustTypeLifetimeContract,
} from "./model.js";
export {
  emptyRustLifetimeIndex,
  rustPlaceholderLifetime,
  rustStaticLifetime,
} from "./model.js";
