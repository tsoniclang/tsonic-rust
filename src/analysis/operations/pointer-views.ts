import { selectTsonicPointerView } from "@tsonic/source-core/facts";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../policy/operations/contracts.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  isRustAbsenceCarrier,
  rustSourceLocationTargetType,
  rustOptionalLocationPointeeCarrier,
  rustOptionTargetType,
  rustUnitTargetType,
} from "../../target-model/types/index.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import { recordRustTypedLocationCall } from "./typed-locations.js";
import { rustLocationCallbackCarrier } from "./location-callbacks.js";
import { rejectSelectedOperation } from "./provider/result.js";

export function selectRustPointerViewCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const selected = selectTsonicPointerView(context.ast, context.source.sourceFacts, request.source.call);
  if (selected === undefined) return undefined;
  const reject = (reason: string): RustPolicySelection<RustCheckedCallSelectionResult> => rejectSelectedOperation(request.source.call, context,
    "RUST_POINTER_VIEW_NOT_PROVEN", reason);
  if (selected.kind === "rejected") return reject(selected.reason);
  const view = selected.operation;
  const arguments_ = request.source.sourceArguments;
  if (arguments_.length !== 3 || arguments_[0]?.expression !== view.pointerExpression ||
    arguments_[1]?.expression !== view.readExpression || arguments_[2]?.expression !== view.writeExpression) {
    return reject("Pointer views require the exact checked base, read and write arguments.");
  }
  const pointee = resolveRustTargetTypeRef(view.explicitPointeeTypeNode ?? view.pointeeType, context, options);
  const operand = resolveRustTargetTypeRef(view.pointerExpression, context, options);
  const operandPointee = rustOptionalLocationPointeeCarrier(operand);
  const sourcePointee = operandPointee ??
    resolveRustTargetTypeRef(view.sourcePointeeType, context, options);
  if (pointee === undefined || sourcePointee === undefined ||
    (operandPointee === undefined
      ? !view.optional || !isRustAbsenceCarrier(operand)
      : !rustTargetTypeRefEquals(operandPointee, sourcePointee))) {
    return reject("Pointer views require exact source and destination pointee carriers.");
  }
  const source = rustSourceLocationTargetType(sourcePointee);
  const target = rustSourceLocationTargetType(pointee);
  const parameters = [
    view.optional ? rustOptionTargetType(source) : source,
    rustLocationCallbackCarrier(view.readExpression, [], pointee, context.ast),
    rustLocationCallbackCarrier(view.writeExpression, [pointee], rustUnitTargetType(), context.ast),
  ];
  return recordRustTypedLocationCall(request, {
    call: request.source.call, operation: "view-pointer", pointeeCarrier: pointee,
    locationCarrier: target, pointerExpression: view.pointerExpression,
    sourcePointeeCarrier: sourcePointee, optional: view.optional,
    readExpression: view.readExpression, writeExpression: view.writeExpression,
  }, parameters, view.optional ? rustOptionTargetType(target) : target,
  [sourcePointee, pointee], context);
}
