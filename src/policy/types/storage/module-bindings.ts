import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustModuleBindingFact } from "../../../target-model/records/operations/operation-selections.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";

export function selectRustModuleValueStorage(
  declarationKind: "const" | "let" | "var", valueCarrier: TargetTypeRef,
  source: { readonly addressTaken: boolean; readonly scalarLiteral: boolean; readonly stringLiteral: boolean;
    readonly stringStable: boolean; readonly initialized: boolean },
): Exclude<RustModuleBindingFact, { readonly storage: "native-callable" }> {
  const constant = declarationKind === "const" && !source.addressTaken &&
    (source.scalarLiteral || source.stringLiteral && source.stringStable && isRustStringCarrier(valueCarrier));
  return constant ? { declarationKind: "const", storage: "native-const", valueCarrier }
    : { declarationKind, storage: "module-cell", initialization: source.initialized ? "value" : "declaration", valueCarrier };
}
