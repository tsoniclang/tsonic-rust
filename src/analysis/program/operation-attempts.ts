import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustCheckedElementSelectionInput, RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../policy/operations/contracts.js";
import type { RustPreparedDeferredCheckedCall } from "../operations/provider/calls/deferred.js";
import type { RustOperationsProviderOptions } from "../operations/provider/model.js";

type AcceptedCall = Extract<RustPolicySelection<RustCheckedCallSelectionResult>, { readonly kind: "accept" }>;
type AcceptedMember = Extract<RustPolicySelection<RustCheckedOperationSelectionResult>, { readonly kind: "accept" }>;

export type RustOperationAttempt =
  | { readonly kind: "attempted" }
  | { readonly kind: "checked-call"; readonly request: RustCheckedCallSelectionInput;
      readonly options: RustOperationsProviderOptions; readonly selection: AcceptedCall;
      readonly prepared?: { readonly value: RustPreparedDeferredCheckedCall; readonly callbackFallible: boolean } }
  | { readonly kind: "property"; readonly request: RustCheckedPropertySelectionInput;
      readonly options: RustOperationsProviderOptions; readonly selection: AcceptedMember }
  | { readonly kind: "element"; readonly request: RustCheckedElementSelectionInput;
      readonly options: RustOperationsProviderOptions; readonly selection: AcceptedMember };
