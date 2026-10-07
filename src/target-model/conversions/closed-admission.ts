import type { TargetTypeRef } from "../types/model.js";
import type { RustValueConversion } from "../operations/model.js";
import type { RustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustClosedValueRetainsError } from "../types/carriers/closed-values.js";
import { rustJsRecordValueAdmission, rustJsSharedObjectValueAdmission } from "./closed-record.js";
import { rustNumberBoxingConversionId } from "./number-boxing.js";
import {
  isRustAbsenceCarrier, rustCarrierSupportsClone, rustCarrierSupportsTrait,
  rustEmptyObjectTargetType, rustJsClosedValueCarrierTraitPath, rustJsErrorTargetType,
  rustJsSymbolTargetType, rustJsValueTargetType, rustProgramErrorTargetType,
  rustSourcePrimitiveTargetType, rustStringTargetType, rustTsValueAdmission, rustTsValueTargetType,
} from "../types/index.js";
import {
  rustAbsenceToJsValueConversion, rustBoolToJsValueConversion, rustJsValueCloneConversion,
  rustStringToJsValueConversion, rustSymbolToJsValueConversion, rustTsValueCloneConversion,
} from "./model.js";

export type RustClosedValueAdmissionConversion = Extract<RustValueConversion, {
  readonly kind: "semantic-conversion" | "ts-value-from-closed-carrier" | "js-value-from-closed-carrier";
}>;

export function rustClosedValueAdmissionConversion(
  source: TargetTypeRef, target: TargetTypeRef, definitions: RustTypeDefinitions,
): RustClosedValueAdmissionConversion | undefined {
  if (rustTargetTypeRefEquals(target, rustTsValueTargetType())) {
    if (rustTargetTypeRefEquals(source, target)) return rustTsValueCloneConversion;
    return rustClosedValueRetainsError(source, definitions) || rustTsValueAdmission(source, definitions) !== undefined
      ? Object.freeze({ kind: "ts-value-from-closed-carrier", source }) : undefined;
  }
  if (!rustTargetTypeRefEquals(target, rustJsValueTargetType())) return undefined;
  if (rustTargetTypeRefEquals(source, rustJsErrorTargetType())) {
    return Object.freeze({ kind: "semantic-conversion", id: "js-value-from-error" });
  }
  if (rustTargetTypeRefEquals(source, target)) return rustJsValueCloneConversion;
  if (rustTargetTypeRefEquals(source, rustSourcePrimitiveTargetType("bool"))) return rustBoolToJsValueConversion;
  const numberBoxing = source.kind === "source-primitive" ? rustNumberBoxingConversionId(source.name) : undefined;
  if (numberBoxing !== undefined) return Object.freeze({ kind: "semantic-conversion", id: numberBoxing });
  if (isRustAbsenceCarrier(source)) return rustAbsenceToJsValueConversion;
  if (rustTargetTypeRefEquals(source, rustStringTargetType())) return rustStringToJsValueConversion;
  if (rustTargetTypeRefEquals(source, rustJsSymbolTargetType())) return rustSymbolToJsValueConversion;
  return rustTargetTypeRefEquals(source, rustProgramErrorTargetType()) ||
    rustClosedValueRetainsError(source, definitions) || rustTargetTypeRefEquals(source, rustEmptyObjectTargetType()) ||
    rustJsRecordValueAdmission(source) || rustJsSharedObjectValueAdmission(source, definitions) ||
    rustTsValueAdmission(source, definitions)?.kind === "project-object" ||
    rustCarrierSupportsClone(source, definitions) &&
    rustCarrierSupportsTrait(source, rustJsClosedValueCarrierTraitPath, undefined, undefined, definitions)
    ? Object.freeze({ kind: "js-value-from-closed-carrier", source }) : undefined;
}
