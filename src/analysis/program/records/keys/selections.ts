import type { ArgumentPassingFact } from "@tsonic/tsts";
import type { RustSelectedTargetSignature } from "../../../../target-model/types/model.js";
import { defineRustPlanKey } from "../key.js";
import { rustSelectedTargetSignatureEquals, rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustRuntimeCarrierSelection, RustConversionSelection } from "../../../../target-model/records/selections.js";

export const rustRuntimeCarrierKey = defineRustPlanKey<RustRuntimeCarrierSelection>(
  "runtimeCarrier",
  (left, right) => rustTargetTypeRefEquals(left.carrier, right.carrier),
);

export const rustSelectedCallKey = defineRustPlanKey<RustSelectedTargetSignature>(
  "selectedCall",
  rustSelectedTargetSignatureEquals,
);

export const rustConversionKey = defineRustPlanKey<RustConversionSelection>(
  "conversion",
  (left, right) => rustTargetTypeRefEquals(left.convertedType, right.convertedType),
);

export const rustArgumentPassingKey = defineRustPlanKey<ArgumentPassingFact>(
  "argumentPassing",
  (left, right) => left.mode === right.mode &&
    left.storageExpression === right.storageExpression,
);
