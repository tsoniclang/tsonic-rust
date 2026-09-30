import type { RustCheckedCallSelectionInput } from "../../../../policy/operations/contracts.js";
import type { RustSelectedTargetSignature, RustTargetMember } from "../../../../target-model/types/model.js";
import { selectedCallCalleeDeclaration, selectedCallCalleeSymbol } from "../operators.js";

export function selectedRustCallSignature(
  request: RustCheckedCallSelectionInput,
  member: RustTargetMember,
): RustSelectedTargetSignature {
  const symbol = selectedCallCalleeSymbol(request);
  const declaration = selectedCallCalleeDeclaration(request);
  return {
    member,
    ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
    ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
    ...(symbol === undefined ? {} : { sourceCalleeSymbol: symbol }),
    ...(declaration === undefined ? {} : { sourceCalleeDeclaration: declaration }),
    ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {}
      : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
    ...(member.providerDeclaration === undefined ? {} : { providerDeclaration: member.providerDeclaration }),
  };
}
