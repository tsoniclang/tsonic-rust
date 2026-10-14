import { rustSourceCallableValueEquals } from "../../../../target-model/records/equality.js";

import { defineRustPlanKey } from "../key.js";
import type { RustPlanKey } from "../key.js";
import type { RustSourceCallableValueFact } from "../../../../target-model/records/operation-selections.js";

export const rustSourceCallableValueFactKey: RustPlanKey<RustSourceCallableValueFact> = defineRustPlanKey(
  "sourceCallableValue", rustSourceCallableValueEquals,
);

export const rustDirectCallableReferenceFactKey: RustPlanKey<RustSourceCallableValueFact> = defineRustPlanKey(
  "directCallableReference", rustSourceCallableValueEquals,
);
