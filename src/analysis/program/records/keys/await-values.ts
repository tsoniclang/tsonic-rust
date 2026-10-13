import { defineRustPlanKey } from "../key.js";
import type { RustPlanKey } from "../key.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustAwaitValueFact } from "../../../../target-model/records/await-values.js";

export const rustAwaitValueFactKey: RustPlanKey<RustAwaitValueFact> = defineRustPlanKey("awaitValue", closedMetadataEquals);
