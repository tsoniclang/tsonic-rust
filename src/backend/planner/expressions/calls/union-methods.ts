import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustSourceCallEffectsFactKey } from "../../../../analysis/facts/keys.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";
import type { RustCallGenericArgument, RustExpr, RustPattern } from "../../../target-ast/nodes.js";
import { rustFutureOutputCarrier, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics, type TargetTypeRef } from "../../../../target-model/types/index.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustActiveErrorType, rustErrorBoundaryForProjectMember, rustErrorType } from "../../program/plan-context.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustUnionTypePathInContext } from "../../types/render.js";
import { planExpression } from "../entry.js";
import { planRustNonConsumingValue } from "../typed-locations.js";
import { applyRustValueConversion } from "../value-conversions.js";
import { rustValueConversionContract, substituteRustValueConversion } from "../../../../target-model/conversions/contracts.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { planRustVirtualProjectMethodCall } from "../../objects/project-method-dispatch.js";

export function planRustUnionMethodCall(
  node: Node,
  callee: Node | undefined,
  args: readonly RustExpr[],
  fact: Extract<RustTargetOperationFact, { kind: "source-call" }>,
  target: Extract<RustTargetOperationFact, { kind: "source-call" }>["target"] & { form: "union-method" },
  genericArguments: readonly RustCallGenericArgument[] | undefined,
  typeArguments: readonly TargetTypeRef[],
  context: RustPlanContext,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const receiverNode = callee === undefined || !ast.is.IsPropertyAccessExpression(callee) ? undefined : Node_Expression(ast, callee);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const variants = context.input.program.typeDefinitions.sourceUnionVariants(target.receiverCarrier);
  const typePath = rustUnionTypePathInContext(target.receiverCarrier, context);
  const selectedCall = context.input.program.facts.getSelectedTargetCall(node);
  const selected = selectedCall?.sourceUnionMethods;
  const substitutions = selectedCall === undefined ? undefined : rustTargetGenericBindingsForArguments(
    selectedCall.member.genericParameters ?? [], fact.targetGenericArguments ?? [],
  );
  const effects = context.input.program.facts.getFact(node, rustSourceCallEffectsFactKey);
  if (receiver === undefined || receiverNode === undefined || variants === undefined || typePath === undefined ||
    context.syntheticNames === undefined || selected === undefined || substitutions === undefined || effects?.unionBranches === undefined ||
    target.variants.length !== variants.length || target.variants.length !== selected.variants.length ||
    target.variants.length !== effects.unionBranches.length || !rustTargetTypeRefEquals(selected.receiverCarrier, target.receiverCarrier)) return undefined;
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "union_receiver");
  const mutable = target.variants.some(variant => variant.mutatesSelf);
  const bindings = [{ name: receiverName, value: planRustNonConsumingValue(receiverNode, receiver, context), ...(mutable ? { mutable: true } : {}) },
    ...args.map((value, index) => ({ name: allocateRustSyntheticName(context.syntheticNames!, `union_argument_${index}`), value }))];
  const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
  for (const [index, method] of target.variants.entries()) {
    const variant = variants[index]!;
    const selection = selected.variants[index]!;
    if (variant.name !== method.name || !rustTargetTypeRefEquals(variant.carrier, method.carrier) ||
      selection.declaration !== method.declaration || selection.targetName !== method.targetName ||
      selection.name !== method.name || !rustTargetTypeRefEquals(selection.carrier, method.carrier)) return undefined;
    const selectedReturn = substituteRustTargetGenerics(selection.returnType, substitutions.types,
      substitutions.lifetimes, substitutions.consts, context.input.program.typeFamilies.normalize);
    const selectedConversion = selection.resultConversion === undefined ? undefined
      : substituteRustValueConversion(selection.resultConversion, substitutions.types, substitutions.lifetimes, substitutions.consts);
    if (!rustTargetTypeRefEquals(selectedReturn, method.returnType) || !closedMetadataEquals(selectedConversion, method.resultConversion)) return undefined;
    const payload = allocateRustSyntheticName(context.syntheticNames, "union_value");
    let expression: RustExpr = {
      kind: "method-call", receiver: { kind: "path", path: payload }, method: method.targetName,
      receiverMode: method.mutatesSelf ? "mut-ref" : "ref",
      ...(genericArguments === undefined ? {} : { genericArguments }),
      args: bindings.slice(1).map(binding => ({ kind: "path", path: binding.name })),
    };
    if (method.dispatchOwner !== undefined) {
      const dispatch = context.input.program.projectMethodDispatch.variantForMember(method.declaration, typeArguments);
      if (dispatch === undefined) return undefined;
      const planned = planRustVirtualProjectMethodCall(node, { kind: "path", path: payload },
        method.dispatchOwner, dispatch.virtualSlot,
        bindings.slice(1).map(binding => ({ kind: "path", path: binding.name })), context);
      if (planned === undefined) return undefined;
      expression = planned;
    }
    if (effects.unionBranches[index] === "fallible" && rustFutureOutputCarrier(fact.resultCarrier) === undefined) {
      const resultErrorType = rustActiveErrorType(context);
      const operandBoundary = rustErrorBoundaryForProjectMember(method.declaration, context);
      if (resultErrorType === undefined || operandBoundary === undefined) return undefined;
      expression = { kind: "try", expr: expression, resultErrorType, operandErrorType: rustErrorType(operandBoundary) };
    }
    const result = fact.resultCarrier;
    if (method.resultConversion === undefined) {
      if (!rustTargetTypeRefEquals(method.returnType, result)) return undefined;
    } else {
      const conversion = rustValueConversionContract(method.resultConversion, context.input.program.typeDefinitions);
      if (conversion === undefined || conversion.fallible ||
        !rustTargetTypeRefEquals(conversion.source, method.returnType) ||
        !rustTargetTypeRefEquals(conversion.target, result)) return undefined;
      const converted = applyRustValueConversion(context, expression, method.resultConversion, node, false);
      if (converted === undefined) return undefined;
      expression = converted;
    }
    arms.push({
      pattern: { kind: "tuple-variant", path: `${typePath}::${method.name}`, elements: [{ kind: "binding", name: payload }] },
      expression,
    });
  }
  return { kind: "block", bindings, value: { kind: "match", expression: { kind: "reference", expr: { kind: "path", path: receiverName }, ...(mutable ? { mutable: true } : {}) }, arms } };
}
