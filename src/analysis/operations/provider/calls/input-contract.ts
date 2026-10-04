import { resolveSelectedSourceProfileMember } from "../../../../policy/evidence/selected-source.js";
import { selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { selectJsSurfaceCallInputContract } from "../../../../policy/operations/source-profiles/js/index.js";
import { selectedCallProviderDeclaration } from "../../../../policy/evidence/selected-source.js";
import { providerOperationFact } from "../result.js";
import { checkedCallIsConstruction, instantiateSelectedCallTemplate } from "./instantiation.js";
import { selectedCallSourceParameterCarriers } from "./source-sequences.js";
import { createRustJsCallRequest } from "./source-profile-request.js";
import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function selectedRustCheckedCallInputCarrier(
  request: RustCheckedCallSelectionInput,
  argumentIndex: number,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  if (checkedCallIsConstruction(request, context)) return undefined;
  const sourceMember = resolveSelectedSourceProfileMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (sourceMember?.profile === "js") {
    const nativeRequest = createRustJsCallRequest(request, context, options);
    const selection = nativeRequest === undefined ? undefined
      : selectJsSurfaceCallInputContract(nativeRequest, argumentIndex, context.typeDefinitions);
    return selection?.fact.kind !== "provider-operation" ? undefined
      : selectedCallSourceParameterCarriers(request, selection.fact, selection.parameterCarriers, context, options)?.get(argumentIndex);
  }
  if (sourceMember !== undefined) return undefined;
  const provider = selectedCallProviderDeclaration(request, context);
  if (provider.kind !== "selected") return undefined;
  const selected = selectRustProviderOperation(options.providerRows, provider.identity, "method");
  if (selected.kind !== "selected") return undefined;
  const instantiated = instantiateSelectedCallTemplate(request, providerOperationFact(selected.row), context, options);
  return instantiated === undefined ? undefined : selectedCallSourceParameterCarriers(
    request, instantiated.template, instantiated.template.parameterCarriers, context, options,
  )?.get(argumentIndex);
}
