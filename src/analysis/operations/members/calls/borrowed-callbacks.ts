import { selectRustBorrowedCallbackOperation } from "../../../../policy/operations/members/callbacks.js";
import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { Node_Initializer, sourceCallableValueParameters } from "@tsonic/target-api/source";
import { isRustStringCarrier } from "../../../../target-model/types/index.js";
import { selectedCallArgumentNodes } from "../operators.js";
import type { RustCheckedCallSelectionInput } from "../../../../policy/model/contracts.js";
import type { JsOperationSelection } from "../../../../policy/operations/source-profiles/js/index.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { Node } from "@tsonic/tsts";
import type { RustSourceParameterResourceError } from "../../../callables/calls/source-callable-abi.js";

type RustBorrowedCallbackSelection =
  | { readonly kind: "selected"; readonly selection: JsOperationSelection }
  | RustSourceParameterResourceError
  | { readonly kind: "rejected"; readonly parameter: Node; readonly reason: string }
  | { readonly kind: "unavailable"; readonly parameter: Node };

export function selectBorrowedCallbackParameters(
  request: RustCheckedCallSelectionInput,
  selection: JsOperationSelection,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustBorrowedCallbackSelection {
  const callback = selection.callback;
  const borrowed = callback?.borrowedParameters;
  if (callback === undefined || borrowed === undefined || selection.fact.kind !== "provider-operation") return { kind: "selected", selection };
  const expression = selectedCallArgumentNodes(request)[callback.sourceArgumentIndex];
  const carrier = selection.parameterCarriers?.[callback.sourceArgumentIndex];
  if (expression === undefined || carrier?.kind !== "closure" ||
    !(context.ast.is.IsArrowFunction(expression) || context.ast.is.IsFunctionExpression(expression))) return { kind: "selected", selection };
  const parameters = sourceCallableValueParameters(context.ast, expression, context.semanticsFor(expression));
  if (parameters === undefined || parameters.length !== carrier.args.length || !carrier.args.every(isRustStringCarrier) ||
    !parameters.every(parameter => parameter !== undefined &&
      context.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken === undefined &&
      context.ast.questionToken(parameter) === undefined && Node_Initializer(context.ast, parameter) === undefined)) return { kind: "selected", selection };
  let shared = true;
  for (const [index, parameter] of parameters.entries()) {
    if (parameter === undefined) continue;
    const sourceFile = context.ast.getSourceFile(parameter);
    if (sourceFile === undefined) return { kind: "unavailable", parameter };
    const completed = options.sourceCallableAbi.resolveParameterAbi(parameter,
      { ...context, currentSourceFile: sourceFile, currentSemantics: context.semanticsFor(parameter) }, options, carrier.args[index]);
    if (completed === undefined) return { kind: "unavailable", parameter };
    if (completed.kind === "resource-error") return completed;
    if (completed.kind === "rejected") return { kind: "rejected", parameter, reason: completed.reason };
    if (!options.sourceCallableAbi.canUseSharedBorrow(parameter)) shared = false;
  }
  return { kind: "selected", selection: shared ? selectRustBorrowedCallbackOperation(selection, carrier) : selection };
}
