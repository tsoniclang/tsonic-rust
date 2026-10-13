import { defineRustPlanKey } from "../key.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustGenericCallableInvocationFact } from "../../../../target-model/records/generic-callable-effects.js";

export const rustGenericCallableInvocationFactKey = defineRustPlanKey<RustGenericCallableInvocationFact>(
  "genericCallableInvocation", closedMetadataEquals);
