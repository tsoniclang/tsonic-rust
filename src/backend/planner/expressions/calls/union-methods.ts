import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCallGenericArgument, RustExpr, RustPattern } from "../../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustErrorBoundaryForProjectMember } from "../../program/plan-context.js";
import { rustErrorType, rustPropagateLocalError } from "../../program/fallible-boundaries.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustUnionTypePathInContext } from "../../types/render.js";
import { planExpression } from "../entry.js";
import { applyRustValueConversion } from "../value-conversions.js";
import { planRustVirtualProjectMethodCall } from "../../objects/project-method-dispatch.js";

export function planRustUnionMethodCall(node: Node, args: readonly RustExpr[],
  genericArguments: readonly RustCallGenericArgument[] | undefined, typeArguments: readonly TargetTypeRef[],
  context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.unionCall.get(node)
    ?? failRustPlannerInvariant("An admitted union call requires its exact selected native branches.", node);
  const receiver = planExpression(selected.receiver, context);
  const path = rustUnionTypePathInContext(selected.target.receiverCarrier, context);
  const names = context.syntheticNames;
  if (receiver === undefined || path === undefined || names === undefined)
    failRustPlannerInvariant("An admitted union call requires its native receiver, union type and hygienic scope.", node);
  const receiverName = allocateRustSyntheticName(names, "union_receiver");
  const bindings = [{ name: receiverName, value: receiver, mutable: selected.mutable },
    ...args.map((value, index) => ({ name: allocateRustSyntheticName(names, `union_argument_${index}`), value }))];
  const arguments_: RustExpr[] = bindings.slice(1).map(binding => ({ kind: "path", path: binding.name }));
  const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
  for (const [index, method] of selected.target.variants.entries()) {
    const payload = allocateRustSyntheticName(names, "union_value");
    let expression: RustExpr = { kind: "method-call", receiver: { kind: "path", path: payload }, method: method.targetName,
      receiverMode: method.mutatesSelf ? "mut-ref" : "ref", args: arguments_,
      ...(genericArguments === undefined ? {} : { genericArguments }) };
    if (method.dispatchOwner !== undefined) {
      const dispatch = context.input.program.records.methodDispatch.get(method.declaration, typeArguments)
        ?? failRustPlannerInvariant("An admitted virtual union method requires its exact native slot specialization.", node);
      expression = planRustVirtualProjectMethodCall(node, { kind: "path", path: payload }, method.dispatchOwner, dispatch.virtualSlot, arguments_, context)
        ?? failRustPlannerInvariant("An admitted virtual union method requires its native call syntax.", node);
    }
    if (selected.fallible[index] === true) {
      const boundary = rustErrorBoundaryForProjectMember(method.declaration, context);
      if (context.fallibleBoundary === undefined || boundary === undefined)
        failRustPlannerInvariant("An admitted fallible union method requires its exact source error boundary.", node);
      expression = rustPropagateLocalError(context.fallibleBoundary, rustErrorType(boundary), expression)
        ?? failRustPlannerInvariant("An admitted union method requires its native error propagation.", node);
    }
    if (method.resultConversion !== undefined) expression = applyRustValueConversion(context, expression, method.resultConversion, node)
      ?? failRustPlannerInvariant("An admitted union method requires its selected native result conversion.", node);
    arms.push({ pattern: { kind: "tuple-variant", path: `${path}::${method.name}`, elements: [{ kind: "binding", name: payload }] }, expression });
  }
  return rustValueBlock(bindings, { kind: "match", expression: { kind: "reference", expr: { kind: "path", path: receiverName },
    ...(selected.mutable ? { mutable: true } : {}) }, arms });
}
