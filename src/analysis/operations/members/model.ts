import type { RustProjectMethodPropertyPlan } from "../../project-types/method-properties.js";
import type { RustProjectMethodDispatchPlanRegistry } from "../../project-types/method-dispatch.js";
import type { RustProjectTypePolicy } from "../../project-types/index.js";
import type { RustSourceCallableAbiResolver } from "../../callables/calls/source-callable-abi.js";
import type { RustTargetTypeResolutionOptions } from "../../source-evidence/types/resolution/index.js";
import type { RustReceiverFieldAliasQueries } from "../../project-types/receiver-field-aliases.js";

export interface RustOperationsProviderOptions extends RustTargetTypeResolutionOptions {
  readonly dispatchContextInputFor: (input: unknown) =>
    import("../../../target-model/operations/dispatch-contexts.js").RustResolvedDispatchContextInput | undefined;
  readonly receiverFieldAliases: RustReceiverFieldAliasQueries;
  readonly providerExports: readonly import("../../../target-model/identities/provider-relations.js").RustProviderExportRow[];
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlanRegistry;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
}
