import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustSourceUnionCarrierValue } from "../../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustSourceCallEffectsFactKey } from "../../../../analysis/facts/keys.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";
import type { RustExpr, RustPattern } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustActiveErrorType, rustErrorBoundaryForProjectMember, rustErrorType } from "../../program/plan-context.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustUnionTypePathInContext } from "../../types/render.js";
import { planExpression } from "../entry.js";
import { planRustNonConsumingValue } from "../typed-locations.js";
import { applyRustValueConversion } from "../value-conversions.js";
import { rustValueConversionContract } from "../../../../target-model/conversions/contracts.js";

export function planRustUnionMethodCall(
  node: Node,
  callee: Node | undefined,
  args: readonly RustExpr[],
  target: Extract<RustTargetOperationFact, { kind: "source-call" }>["target"] & { form: "union-method" },
  context: RustPlanContext,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const receiverNode = callee === undefined || !ast.is.IsPropertyAccessExpression(callee) ? undefined : Node_Expression(ast, callee);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const union = rustSourceUnionCarrierValue(target.receiverCarrier);
  const typePath = rustUnionTypePathInContext(target.receiverCarrier, context);
  const selected = context.input.program.facts.getSelectedTargetCall(node)?.sourceUnionMethods;
  const effects = context.input.program.facts.getFact(node, rustSourceCallEffectsFactKey);
  if (receiver === undefined || receiverNode === undefined || union === undefined || typePath === undefined ||
    context.syntheticNames === undefined || selected === undefined || effects?.unionBranches === undefined ||
    target.variants.length !== union.variants.length || target.variants.length !== selected.variants.length ||
    target.variants.length !== effects.unionBranches.length || !rustTargetTypeRefEquals(selected.receiverCarrier, target.receiverCarrier)) return undefined;
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "union_receiver");
  const mutable = target.variants.some(variant => variant.mutatesSelf);
  const bindings = [{ name: receiverName, value: planRustNonConsumingValue(receiverNode, receiver, context), ...(mutable ? { mutable: true } : {}) },
    ...args.map((value, index) => ({ name: allocateRustSyntheticName(context.syntheticNames!, `union_argument_${index}`), value }))];
  const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
  for (const [index, method] of target.variants.entries()) {
    const variant = union.variants[index]!;
    const selection = selected.variants[index]!;
    if (variant.name !== method.name || !rustTargetTypeRefEquals(variant.carrier, method.carrier) ||
      selection.declaration !== method.declaration || selection.targetName !== method.targetName ||
      selection.name !== method.name || !rustTargetTypeRefEquals(selection.carrier, method.carrier)) return undefined;
    const payload = allocateRustSyntheticName(context.syntheticNames, "union_value");
    let expression: RustExpr = {
      kind: "method-call", receiver: { kind: "path", path: payload }, method: method.targetName,
      receiverMode: method.mutatesSelf ? "mut-ref" : "ref",
      args: bindings.slice(1).map(binding => ({ kind: "path", path: binding.name })),
    };
    if (effects.unionBranches[index] === "fallible") {
      const resultErrorType = rustActiveErrorType(context);
      const operandBoundary = rustErrorBoundaryForProjectMember(method.declaration, context);
      if (resultErrorType === undefined || operandBoundary === undefined) return undefined;
      expression = { kind: "try", expr: expression, resultErrorType, operandErrorType: rustErrorType(operandBoundary) };
    }
    const result = context.input.program.facts.getSelectedTargetCall(node)?.member.returnType;
    if (result === undefined) return undefined;
    if (selection.resultConversion === undefined) {
      if (!rustTargetTypeRefEquals(selection.returnType, result)) return undefined;
    } else {
      const conversion = rustValueConversionContract(selection.resultConversion);
      if (conversion === undefined || conversion.fallible ||
        !rustTargetTypeRefEquals(conversion.source, selection.returnType) ||
        !rustTargetTypeRefEquals(conversion.target, result)) return undefined;
      const converted = applyRustValueConversion(context, expression, selection.resultConversion, node, false);
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
