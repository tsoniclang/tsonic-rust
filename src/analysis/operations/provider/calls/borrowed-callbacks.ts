import { selectRustBorrowedCallbackOperation } from "../../../../policy/operations/members/callbacks.js";
import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { Node_Initializer } from "@tsonic/target-api/source";
import { isRustStringCarrier } from "../../../../target-model/types/index.js";
import { selectedCallArgumentNodes } from "../operators.js";
import type { RustCheckedCallSelectionInput } from "../../../../policy/operations/contracts.js";
import type { JsOperationSelection } from "../../../../policy/operations/source-profiles/js/index.js";
import type { RustOperationsProviderOptions } from "../model.js";

export function selectBorrowedCallbackParameters(
  request: RustCheckedCallSelectionInput,
  selection: JsOperationSelection,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): JsOperationSelection {
  const callback = selection.callback;
  const borrowed = callback?.borrowedParameters;
  if (callback === undefined || borrowed === undefined || selection.fact.kind !== "provider-operation") return selection;
  const expression = selectedCallArgumentNodes(request)[callback.sourceArgumentIndex];
  const carrier = selection.parameterCarriers?.[callback.sourceArgumentIndex];
  if (expression === undefined || carrier?.kind !== "closure" ||
    !(context.ast.is.IsArrowFunction(expression) || context.ast.is.IsFunctionExpression(expression))) return selection;
  const parameters = context.ast.parameters(expression);
  if (parameters.length !== carrier.args.length || !carrier.args.every(isRustStringCarrier) ||
    !parameters.every(parameter => parameter !== undefined &&
      context.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken === undefined &&
      context.ast.questionToken(parameter) === undefined && Node_Initializer(context.ast, parameter) === undefined &&
      options.sourceCallableAbi.canUseSharedBorrow(parameter, context, options))) return selection;
  return selectRustBorrowedCallbackOperation(selection, carrier);
}
