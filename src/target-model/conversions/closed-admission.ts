import type { RustValueConversion } from "../operations/model.js";

export type RustClosedValueAdmissionConversion = Extract<RustValueConversion, {
  readonly kind: "semantic-conversion" | "ts-value-from-closed-carrier" | "js-value-from-closed-carrier";
}>;
