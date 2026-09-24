import type { RustProviderOperationRow } from "../../providers/packages/model.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";

export function rustProviderArgumentBorrowsString(
  row: RustProviderOperationRow,
  argumentIndex: number,
): boolean {
  const form = row.target;
  if (row.isAsync === true || form.form !== "call" ||
    (form.chain?.length ?? 0) !== 0 || (row.genericParameters?.length ?? 0) !== 0 ||
    form.argOrder !== undefined && form.argOrder.some((index, position) => index !== position) ||
    !isRustStringCarrier(row.parameterCarriers?.[argumentIndex])) return false;
  const conversion = form.argConversions?.[argumentIndex];
  const mode = form.argModes?.[argumentIndex] ?? "value";
  if (conversion === undefined) return mode === "ref";
  const contract = rustValueConversionContract(conversion);
  return mode === "value" && contract?.sourceMode === "ref" &&
    contract.lowering === "borrowed-str-from-owned-string";
}
