import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../../../policy/model/contracts.js";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustSelectedTargetSignatureEquals } from "../../../../target-model/types/selected-call-equality.js";
import type { RustTargetMember } from "../../../../target-model/types/model.js";
import type { RustSelectedTargetOperation, RustSelectedTargetSignature } from "../../../../target-model/records/operations/member-selections.js";
import type { Node, ResolvedSourceCallInfo } from "@tsonic/tsts";
import { rustFoundationForSelectedCall } from "../../../foundation/requirements.js";
import { createRustRecordFamily } from "../family.js";

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
  "sourceSelectedSignatureParameters" | "sourceSelectedMethodTypeArguments" | "nativeParameterDeclarations"> & {
    readonly sourceImplementationParameters?: readonly Node[];
  };

export function selectedRustCallSignature(
  request: RustCheckedCallSelectionInput,
  member: RustTargetMember,
  details?: RustSelectedCallDetails,
): RustSelectedTargetSignature {
  const callee = request.source.sourceCallee;
  const symbol = callee.selectedSymbol ?? callee.symbol;
  const declaration = callee.selectedDeclaration ?? callee.declaration;
  const { sourceImplementationParameters, ...selectionDetails } = details ?? {};
  const nativeParameterDeclarations = Object.freeze(sourceImplementationParameters === undefined
    ? member.parameters.map((_, index) => {
        const sourceIndex = selectionDetails.sourceCallableParameterIndexes === undefined
          ? index : selectionDetails.sourceCallableParameterIndexes[index];
        return sourceIndex === undefined ? undefined
          : request.source.sourceSelectedSignatureParameters[sourceIndex]?.parameterDeclaration;
      })
    : [...sourceImplementationParameters]);
  return {
    member,
    nativeParameterDeclarations,
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
    ...selectionDetails,
  };
}

export function selectedRustSourceCallOperation(
  source: ResolvedSourceCallInfo,
  operation: Pick<RustSelectedTargetOperation, "operationId" | "operationKind" | "targetOperation" | "resultType">,
): RustSelectedTargetOperation {
  const callee = source.sourceCalleeAccess === undefined ? source.sourceCallee : source.sourceCalleeAccess;
  return {
    ...operation,
    provenance: {
      sourceExpression: source.call,
      sourceReceiver: source.sourceCalleeAccess === undefined
        ? source.sourceReceiver?.expression : source.sourceCalleeAccess.receiver.expression,
      sourceCallee: source.sourceCallee.expression,
      sourceSelectedSignature: source.selectedSignature,
      sourceSelectedSymbol: callee.selectedSymbol,
      sourceSelectedDeclaration: callee.selectedDeclaration,
      sourceCalleeSymbol: source.sourceCallee.symbol,
      sourceCalleeDeclaration: source.sourceCallee.declaration,
      sourceResultType: source.sourceResultType,
      sourceReturnType: source.sourceResultType,
    },
  };
}
