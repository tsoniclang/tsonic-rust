import type { ResolvedSourceCallInfo } from "@tsonic/tsts";
import type { RustCheckedCallSelectionInput, RustCheckedElementSelectionInput, RustCheckedPropertySelectionInput } from "../../policy/model/contracts.js";
import { sourceArgumentBindingsEqual, sourceSelectedMethodTypeArgumentsEqual, sourceSelectedSignatureParametersEqual } from "../../target-model/types/selected-call-equality.js";

export function rustCheckedCallRequestsEqual(left: RustCheckedCallSelectionInput, right: RustCheckedCallSelectionInput): boolean {
  const source = left.source;
  const other = right.source;
  return (left.target ?? "rust") === (right.target ?? "rust") &&
    left.sourceSelectedDeclaration === right.sourceSelectedDeclaration &&
    source.outcome === other.outcome && source.call === other.call &&
    source.optionalChain === other.optionalChain && source.selectedSignature === other.selectedSignature &&
    source.sourceSelectedSignatureKind === other.sourceSelectedSignatureKind && source.sourceResultType === other.sourceResultType &&
    sourceArgumentBindingsEqual(source.sourceArgumentBindings, other.sourceArgumentBindings) &&
    sourceSelectedSignatureParametersEqual(source.sourceSelectedSignatureParameters, other.sourceSelectedSignatureParameters) &&
    sourceSelectedMethodTypeArgumentsEqual(source.sourceSelectedMethodTypeArguments, other.sourceSelectedMethodTypeArguments) &&
    sourceValueEquals(source.sourceCallee, other.sourceCallee) &&
    sourceValueEquals(source.sourceReceiver, other.sourceReceiver) &&
    source.sourceArguments.length === other.sourceArguments.length &&
    source.sourceArguments.every((argument, index) => sourceValueEquals(argument, other.sourceArguments[index])) &&
    sourceAccessEquals(source.sourceCalleeAccess, other.sourceCalleeAccess);
}

export function rustCheckedPropertyRequestsEqual(left: RustCheckedPropertySelectionInput, right: RustCheckedPropertySelectionInput): boolean {
  return (left.target ?? "rust") === (right.target ?? "rust") && left.expression === right.expression &&
    left.receiver === right.receiver && left.sourceReceiverType === right.sourceReceiverType &&
    left.sourceReceiverDeclaration === right.sourceReceiverDeclaration &&
    left.sourceReceiverValueDeclaration === right.sourceReceiverValueDeclaration &&
    left.sourceReceiverIntrinsic === right.sourceReceiverIntrinsic && left.accessMode === right.accessMode &&
    left.sourceSelectedSymbol === right.sourceSelectedSymbol && left.sourceSelectedDeclaration === right.sourceSelectedDeclaration &&
    left.sourceSelectedReadDeclaration === right.sourceSelectedReadDeclaration &&
    left.sourceSelectedWriteDeclaration === right.sourceSelectedWriteDeclaration &&
    left.sourceSelectedIndex === right.sourceSelectedIndex && left.sourceReadType === right.sourceReadType &&
    left.sourceWriteType === right.sourceWriteType && left.sourceResultType === right.sourceResultType &&
    (left.optionalChain ?? false) === (right.optionalChain ?? false);
}

export function rustCheckedElementRequestsEqual(left: RustCheckedElementSelectionInput, right: RustCheckedElementSelectionInput): boolean {
  return rustCheckedPropertyRequestsEqual(left, right) && left.argument === right.argument &&
    left.sourceArgumentType === right.sourceArgumentType && left.sourceSelectedElementIndex === right.sourceSelectedElementIndex;
}

function sourceValueEquals(left: ResolvedSourceCallInfo["sourceReceiver"], right: ResolvedSourceCallInfo["sourceReceiver"]): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.expression === right.expression && left.type === right.type && left.symbol === right.symbol &&
    left.declaration === right.declaration && left.selectedSymbol === right.selectedSymbol &&
    left.selectedDeclaration === right.selectedDeclaration && left.authoredTypeNode === right.authoredTypeNode;
}

function sourceAccessEquals(left: ResolvedSourceCallInfo["sourceCalleeAccess"], right: ResolvedSourceCallInfo["sourceCalleeAccess"]): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind && left.expression === right.expression &&
    sourceValueEquals(left.receiver, right.receiver) && left.resultType === right.resultType && left.symbol === right.symbol &&
    left.declaration === right.declaration && left.selectedSymbol === right.selectedSymbol &&
    left.selectedDeclaration === right.selectedDeclaration &&
    (left.kind !== "element" || right.kind === "element" && sourceValueEquals(left.argument, right.argument) &&
      left.selectedElementIndex === right.selectedElementIndex);
}
