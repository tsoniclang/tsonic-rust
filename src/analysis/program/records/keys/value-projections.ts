import { rustFlowReadProjectionEquals } from "../../../../target-model/records/equality.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../key.js";
import type { RustPlanKey } from "../key.js";
import type { RustContextualValueConversionFact, RustFlowReadProjectionFact, RustOptionProjectionFact, RustSourceBindingFact } from "../../../../target-model/records/value-projections.js";

export const rustOptionProjectionFactKey: RustPlanKey<RustOptionProjectionFact> =
  defineRustPlanKey("optionProjection", closedMetadataEquals);

export const rustFlowReadProjectionFactKey: RustPlanKey<RustFlowReadProjectionFact> =
  defineRustPlanKey("flowReadProjection", rustFlowReadProjectionEquals);

export const rustContextualValueConversionFactKey: RustPlanKey<RustContextualValueConversionFact> =
  defineRustPlanKey("contextualValueConversion", closedMetadataEquals);

export const rustSourceBindingFactKey: RustPlanKey<RustSourceBindingFact> =
  defineRustPlanKey("sourceBinding", (left, right) =>
    left.scope === right.scope &&
    left.sourceName === right.sourceName &&
    left.sourceDeclaration === right.sourceDeclaration &&
    (left.scope !== "module" ||
      (right.scope === "module" && left.fileName === right.fileName)));


export const rustSelfModeFactKey: RustPlanKey<{ readonly mode: "ref" | "mut-ref" }> =
  defineRustPlanKey("selfMode", (left, right) => left.mode === right.mode);
