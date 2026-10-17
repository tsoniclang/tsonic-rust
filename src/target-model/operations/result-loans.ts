import { closedMetadataKey, hasExactObjectKeys, isClosedMetadata, isDenseDataArray,
  isMetadataRecord } from "../metadata/closed-data.js";

export interface RustNativeResultLoanOrigin {
  readonly kind: "borrow" | "carried";
  readonly input: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly sourceIndex: number };
  readonly inputType: string;
  readonly inputPath: readonly string[];
  readonly lifetime: string;
  readonly mutable: boolean;
}

export interface RustNativeResultLoan {
  readonly resultPath: readonly string[];
  readonly lifetime: string;
  readonly origins: readonly RustNativeResultLoanOrigin[];
}

export type RustNativeInputLoans = {
  readonly origins: readonly RustNativeResultLoanOrigin[];
} & ({ readonly kind: "complete" } | { readonly kind: "unavailable"; readonly reasons: readonly string[] });

export type RustNativeResultLoanContract = {
  readonly declarationIdentity: string;
  readonly resultTypeIdentity: string;
  readonly valueTypeIdentity: string;
  readonly loans: readonly RustNativeResultLoan[];
  readonly inputLoans: RustNativeInputLoans;
} & ({ readonly kind: "complete" } | {
  readonly kind: "unavailable";
  readonly reasons: readonly string[];
});

export function isRustNativeResultLoanContract(value: unknown): value is RustNativeResultLoanContract {
  if (!isClosedMetadata(value) || !isMetadataRecord(value) ||
    !hasExactObjectKeys(value, ["kind", "declarationIdentity", "resultTypeIdentity", "valueTypeIdentity", "loans", "inputLoans",
      ...(value.kind === "unavailable" ? ["reasons"] : [])]) ||
    !nonempty(value.declarationIdentity) || !nonempty(value.resultTypeIdentity) || !nonempty(value.valueTypeIdentity) ||
    !isDenseDataArray(value.loans) || !value.loans.every(isLoan) || !isInputLoans(value.inputLoans)) return false;
  if (value.kind !== "complete" && (value.kind !== "unavailable" ||
    !isDenseDataArray(value.reasons) || value.reasons.length === 0 || !value.reasons.every(nonempty) ||
    new Set(value.reasons).size !== value.reasons.length)) return false;
  const inputs = new Set(value.inputLoans.origins.map(closedMetadataKey));
  return new Set(value.loans.map(loan => closedMetadataKey(loan.resultPath))).size === value.loans.length &&
    value.loans.every(loan => loan.origins.every(origin => inputs.has(closedMetadataKey(origin))));
}

function isInputLoans(value: unknown): value is RustNativeInputLoans {
  if (!isMetadataRecord(value) || !hasExactObjectKeys(value, ["kind", "origins", ...(value.kind === "unavailable" ? ["reasons"] : [])]) ||
    !isDenseDataArray(value.origins) || !value.origins.every(isOrigin) ||
    new Set(value.origins.map(closedMetadataKey)).size !== value.origins.length) return false;
  return value.kind === "complete" || value.kind === "unavailable" && isDenseDataArray(value.reasons) &&
    value.reasons.length > 0 && value.reasons.every(nonempty) && new Set(value.reasons).size === value.reasons.length;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function path(value: unknown): value is readonly string[] {
  return isDenseDataArray(value) && value.every(nonempty);
}

function isLoan(value: unknown): value is RustNativeResultLoan {
  return isMetadataRecord(value) && hasExactObjectKeys(value, ["resultPath", "lifetime", "origins"]) &&
    path(value.resultPath) && nonempty(value.lifetime) && isDenseDataArray(value.origins) &&
    value.origins.length > 0 && value.origins.every(isOrigin) &&
    new Set(value.origins.map(closedMetadataKey)).size === value.origins.length;
}

function isOrigin(value: unknown): value is RustNativeResultLoanOrigin {
  if (!isMetadataRecord(value) || !hasExactObjectKeys(value,
    ["kind", "input", "inputType", "inputPath", "lifetime", "mutable"]) ||
    value.kind !== "borrow" && value.kind !== "carried" || !isMetadataRecord(value.input) ||
    !nonempty(value.inputType) || !path(value.inputPath) || !nonempty(value.lifetime) ||
    typeof value.mutable !== "boolean") return false;
  return value.input.kind === "receiver" ? hasExactObjectKeys(value.input, ["kind"])
    : value.input.kind === "argument" && hasExactObjectKeys(value.input, ["kind", "sourceIndex"]) &&
      typeof value.input.sourceIndex === "number" && Number.isSafeInteger(value.input.sourceIndex) &&
      value.input.sourceIndex >= 0;
}
