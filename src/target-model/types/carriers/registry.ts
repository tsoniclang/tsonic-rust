import type { TargetCarrierRegistryEntry } from "@tsonic/target-api";
import type { TargetTypeRef } from "../model.js";
import { kindsCarrierRegistry } from "./registry-kinds.js";
import { nativeCarrierRegistry } from "./registry-native.js";
import { callablesCarrierRegistry } from "./registry-callables.js";
import { jsCarrierRegistry } from "./registry-js.js";

export const carrierRegistry: readonly TargetCarrierRegistryEntry<TargetTypeRef["kind"]>[] = Object.freeze([
  ...kindsCarrierRegistry,
  ...nativeCarrierRegistry,
  ...callablesCarrierRegistry,
  ...jsCarrierRegistry,
]);
