import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustCheckedElementSelectionInput, RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../policy/model/contracts.js";
import type { RustPreparedDeferredCheckedCall } from "../../target-model/records/callables/deferred-callbacks.js";
import type { RustOperationsProviderOptions } from "../operations/members/model.js";
import type { RustPreparedCallbackEffects } from "../../policy/operations/members/deferred-callbacks.js";

type AcceptedCall = Extract<RustPolicySelection<RustCheckedCallSelectionResult>, { readonly kind: "accept" }>;
type AcceptedMember = Extract<RustPolicySelection<RustCheckedOperationSelectionResult>, { readonly kind: "accept" }>;

export type RustOperationAttempt =
  | { readonly kind: "attempted" }
  | { readonly kind: "checked-call"; readonly request: RustCheckedCallSelectionInput;
      readonly options: RustOperationsProviderOptions; readonly selection: AcceptedCall;
      readonly prepared?: { readonly value: RustPreparedDeferredCheckedCall; readonly callbackEffects: RustPreparedCallbackEffects } }
  | { readonly kind: "property"; readonly request: RustCheckedPropertySelectionInput;
      readonly options: RustOperationsProviderOptions; readonly selection: AcceptedMember }
  | { readonly kind: "element"; readonly request: RustCheckedElementSelectionInput;
      readonly options: RustOperationsProviderOptions; readonly selection: AcceptedMember };
