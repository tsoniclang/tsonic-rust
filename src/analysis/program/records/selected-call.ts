import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../../policy/operations/contracts.js";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { rustSelectedTargetSignatureEquals } from "../../../target-model/types/equality.js";
import type { RustSelectedTargetSignature, RustTargetMember } from "../../../target-model/types/model.js";
import { rustFoundationForSelectedCall } from "../../foundation/requirements.js";
import { createRustRecordFamily } from "./family.js";

export interface RustSelectedCallProducer {
  readonly records: RustRecordFamily<RustSelectedTargetSignature>;
  checked(request: RustCheckedCallSelectionInput, selection: RustPolicySelection<RustCheckedCallSelectionResult>): void;
}

export function createRustSelectedCallProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  inherited?: RustRecordFamily<RustSelectedTargetSignature>,
): RustSelectedCallProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.selectedCall", equals: rustSelectedTargetSignatureEquals },
    assertOpen, inherited, value => requireFoundation(rustFoundationForSelectedCall(value)));
  return Object.freeze({
    records: family.reader,
    checked(request: RustCheckedCallSelectionInput, selection: RustPolicySelection<RustCheckedCallSelectionResult>): void {
      assertOpen();
      if (selection.kind !== "accept" || selection.value.kind === "source" ||
        selection.value.kind === "deferred-callback" || selection.value.targetFact?.kind === "flow-marker") return;
      family.writer.set(request.source.call, selection.value.selectedSignature);
    },
  });
}

type RustSelectedCallDetails = Omit<RustSelectedTargetSignature, "member" | "sourceSignature" |
  "sourceCalleeSymbol" | "sourceCalleeDeclaration" | "sourceReturnType" | "sourceArgumentBindings" |
  "sourceSelectedSignatureParameters" | "sourceSelectedMethodTypeArguments">;

export function selectedRustCallSignature(
  request: RustCheckedCallSelectionInput,
  member: RustTargetMember,
  details?: RustSelectedCallDetails,
): RustSelectedTargetSignature {
  const callee = request.source.sourceCallee;
  const symbol = callee.selectedSymbol ?? callee.symbol;
  const declaration = callee.selectedDeclaration ?? callee.declaration;
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
    ...details,
  };
}
