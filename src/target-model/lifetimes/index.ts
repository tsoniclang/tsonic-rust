export {
  rustLifetimeKey,
  rustLifetimeName,
  rustLifetimesEqual,
  rustCallScopedElisionLifetime,
  isRustLifetimeRef,
} from "./identity.js";
export { rustLifetimeOutlives } from "./outlives.js";
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
