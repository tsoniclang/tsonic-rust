import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export const rustIndexedFieldKeyArgument = defineRustPlanKey<{
  readonly carrier: TargetTypeRef;
  readonly evaluate: boolean;
}>("indexedFieldKeyArgument", closedMetadataEquals);
