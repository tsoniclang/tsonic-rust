import { kindsCarrierRegistry } from "./kinds.mjs";
import { nativeCarrierRegistry } from "./native.mjs";
import { callablesCarrierRegistry } from "./callables.mjs";
import { jsCarrierRegistry } from "./js.mjs";
import { producersCarrierRegistry } from "./producers.mjs";

export const carrierRegistry = Object.freeze([
  ...kindsCarrierRegistry,
  ...nativeCarrierRegistry,
  ...callablesCarrierRegistry,
  ...jsCarrierRegistry,
  ...producersCarrierRegistry,
]);
