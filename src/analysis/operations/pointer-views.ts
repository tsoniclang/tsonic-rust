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
  isRustDefinitelyNullishCarrier,
  rustClosureTargetType,
  rustLocationTargetType,
  rustOptionalLocationPointeeCarrier,
  rustOptionTargetType,
  rustUnitTargetType,
} from "../../target-model/types/index.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import { acceptSelectedCall } from "./provider/calls/instantiation.js";
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
  const sourcePointee = resolveRustTargetTypeRef(view.sourcePointeeType, context, options);
  const operand = resolveRustTargetTypeRef(view.pointerExpression, context, options);
  const operandPointee = rustOptionalLocationPointeeCarrier(operand);
  if (pointee === undefined || sourcePointee === undefined ||
    (operandPointee === undefined
      ? !view.optional || !isRustDefinitelyNullishCarrier(operand)
      : !rustTargetTypeRefEquals(operandPointee, sourcePointee))) {
    return reject("Pointer views require exact source and destination pointee carriers.");
  }
  const source = rustLocationTargetType(sourcePointee);
  const target = rustLocationTargetType(pointee);
  const parameters = [
    view.optional ? rustOptionTargetType(source) : source,
    rustClosureTargetType([], pointee),
    rustClosureTargetType([pointee], rustUnitTargetType()),
  ];
  return acceptSelectedCall(request, {
    kind: "provider-operation", operationId: "tsonic.rust.location.view", operationKind: "method",
    target: { form: "call", path: view.optional ? "rt::Location::view_optional" : "rt::Location::view",
      argModes: ["ref", "value", "value"] },
    parameterCarriers: parameters,
    carrierRequirements: [
      { carrier: sourcePointee, requirement: "static" },
      { carrier: pointee, requirement: "static" },
    ],
    resultCarrier: view.optional ? rustOptionTargetType(target) : target,
    isAsync: false, isFallible: false, errorBoundary: "none",
  }, parameters, context, options, { sourceName: "viewPointer" });
}
