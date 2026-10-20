import type { RustGenericCallableCompletionSelection } from "../../../target-model/records/generic-callable-completions.js";

export function sealRustGenericCallableCompletionSelection(selection: Extract<RustGenericCallableCompletionSelection, { readonly kind: "selected" }>): Extract<RustGenericCallableCompletionSelection, { readonly kind: "selected" }> {
  return Object.freeze({ kind: "selected", result: selection.result, members: new Map(selection.members) });
}
