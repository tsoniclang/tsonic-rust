import type { RustProviderOperationTemplate } from "../../target-model/operations/model.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { isRustStringViewCarrier } from "../../target-model/types/carriers/native.js";

export function rustProviderArgumentBorrowsString(
  row: Pick<RustProviderOperationTemplate, "target" | "genericParameters" | "parameterCarriers"> &
    { readonly isAsync?: boolean },
  argumentIndex: number,
): boolean {
  const form = row.target;
  if (row.isAsync === true || form.form !== "call" && form.form !== "free-call" && form.form !== "receiver-method" ||
    form.form === "call" && (form.chain?.length ?? 0) !== 0 || (row.genericParameters?.length ?? 0) !== 0 ||
    form.argOrder !== undefined && form.argOrder.some((index, position) => index !== position)) return false;
  const conversion = form.argConversions?.[argumentIndex];
  const mode = form.argModes?.[argumentIndex] ?? "value";
  const carrier = row.parameterCarriers?.[argumentIndex];
  if (!isRustStringCarrier(carrier)) {
    return isRustStringViewCarrier(carrier) && mode === "value" && conversion === undefined;
  }
  if (form.form === "receiver-method") return false;
  if (conversion === undefined) return mode === "ref";
  const contract = rustValueConversionContract(conversion);
  return mode === "value" && contract?.sourceMode === "ref" &&
    contract.lowering === "borrowed-str-from-owned-string";
}
