import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import { planRustClosedNativeProjection } from "./closed-native-values.js";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectDowncastRoute } from "../../../target-model/types/project-types.js";
import type { RustProjectTypeTestPlan } from "../../../target-model/operations/type-tests.js";
import { checkedProjectProjectionResultType, planCheckedProjectProjectionCall } from "./checked-project-projections.js";
import type { RustProjectDowncastFact } from "../../../target-model/types/project-projections.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
} from "./project-objects.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

export interface RustProjectTypeTestSelectionPlan {
  readonly expression: RustExpr;
  readonly selectedCarrier: TargetTypeRef;
  readonly selectedValue: (dispatch: RustExpr) => RustExpr;
}

export function planRustProjectDowncast(
  node: Node,
  expression: RustExpr,
  fact: RustProjectDowncastFact,
  context: RustPlanContext,
): RustExpr | undefined {
  return planRustProjectProjection(node, expression, fact, context, "borrowed");
}

export function planRustProjectProjection(
  node: Node,
  expression: RustExpr,
  selected: RustProjectDowncastFact,
  context: RustPlanContext,
  ownership: "owned" | "borrowed",
): RustExpr | undefined {
  const { sourceCarrier, targetCarrier } = selected;
  const admitted = context.input.program.records.projectProjection.get(node, sourceCarrier, targetCarrier);
  if (admitted === undefined) failRustPlannerInvariant("Project downcast requires its exact sealed native route.", node);
  const targetType = rustTypeFromCarrierInContext(targetCarrier, context);
  if (targetType?.kind !== "named") failRustPlannerInvariant("Project downcast requires its admitted named native target.", node);
  const targetPath = targetType.path;
  if (ownership === "owned") {
    const value: RustExpr = !admitted.optional ? expression
      : { kind: "method-call", receiver: expression, method: "unwrap", args: [] };
    return { kind: "method-call", receiver: { kind: "associated-call", owner: targetType,
      method: "try_from", args: [value] }, method: "unwrap", args: [] };
  }
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "downcast_value",
  );
  const sourceExpression = expression;
  const sourceReference: RustExpr = { kind: "reference", expr: sourceExpression };
  const valuePath: RustExpr = !admitted.optional
    ? { kind: "path", path: valueName }
    : {
        kind: "method-call",
        receiver: {
          kind: "method-call",
          receiver: { kind: "path", path: valueName },
          method: "as_ref",
          args: [],
        },
        method: "unwrap",
        args: [],
      };
  const structuralResultType = admitted.projection.kind === "structural"
    ? checkedProjectProjectionResultType(targetCarrier, context) : undefined;
  if (admitted.projection.kind === "structural" && structuralResultType === undefined)
    failRustPlannerInvariant("Structural downcast requires its admitted checked result carrier.", node);
  const result: RustExpr = admitted.projection.kind === "structural"
    ? { kind: "struct-literal", path: targetPath, fields: [{ name: "dispatch", value: {
        kind: "method-call", receiver: planCheckedProjectProjectionCall(
          cloneProjectField(valuePath, rustProjectObjectDispatchField), admitted.projection.slot, structuralResultType!),
        method: "unwrap", args: [],
      } }] }
    : admitted.projection.kind === "closed"
    ? { kind: "struct-literal", path: targetPath, fields: [
        { name: rustProjectObjectIdentityField, value: cloneProjectField(valuePath, rustProjectObjectIdentityField) },
        { name: rustProjectObjectDispatchField, value: { kind: "method-call", receiver: {
          kind: "method-call", receiver: cloneProjectField(valuePath, rustProjectObjectDispatchField),
          method: admitted.projection.slot, args: [],
        }, method: "unwrap", args: [] } },
      ] }
    : { kind: "method-call", receiver: { kind: "associated-call",
        owner: targetType, method: "try_from",
        args: [{ kind: "method-call", receiver: valuePath, method: "clone", args: [] }],
      }, method: "unwrap", args: [] };
  return rustValueBlock([{ name: valueName, value: sourceReference }], result);
}

export function planRustProjectTypeTest(
  node: Node,
  expression: RustExpr,
  fact: RustProjectTypeTestPlan,
  context: RustPlanContext,
): RustExpr | undefined {
  if (fact.lowering.kind === "closed-native") {
    const selected = planRustClosedNativeProjection(node, expression, fact, context);
    return selected === undefined ? undefined
      : { kind: "option-presence", receiver: selected.expression, present: true };
  }
  if (fact.lowering.kind === "constant") {
    return {
      kind: "evaluate-then",
      effect: expression,
      discard: "value",
      value: { kind: "bool-literal", value: fact.lowering.value },
    };
  }
  if (fact.lowering.kind === "option-presence") {
    return { kind: "option-presence", receiver: expression, present: true };
  }
  const admitted = context.input.program.records.projectProjection.get(node, fact.sourceCarrier, fact.targetCarrier);
  if (admitted?.route === undefined) failRustPlannerInvariant("Project type test requires its exact sealed dispatch route.", node);
  if (admitted.optional) {
    const projected = projectDowncastDispatch({ kind: "path", path: "value" }, admitted.route, context);
    if (projected === undefined) return undefined;
    return {
      kind: "method-call",
      receiver: { kind: "method-call", receiver: expression, method: "as_ref", args: [] },
      method: "is_some_and",
      args: [{
        kind: "closure",
        params: [{ name: "value", byRefCopy: false }],
        body: {
          kind: "option-presence",
          receiver: projected,
          present: true,
        },
      }],
    };
  }
  const selection = planRustProjectTypeTestSelection(node, expression, fact, context);
  return selection === undefined
    ? undefined
    : {
        kind: "option-presence",
        receiver: selection.expression,
        present: true,
      };
}

export function planRustProjectTypeTestSelection(
  node: Node,
  expression: RustExpr,
  fact: RustProjectTypeTestPlan,
  context: RustPlanContext,
): RustProjectTypeTestSelectionPlan | undefined {
  if (fact.lowering.kind !== "dispatch") {
    failRustPlannerInvariant("Dispatch selection requires an admitted native dispatch type test.", node);
  }
  const admitted = context.input.program.records.projectProjection.get(node, fact.sourceCarrier, fact.targetCarrier);
  const targetType = rustTypeFromCarrierInContext(fact.targetCarrier, context);
  if (admitted?.route === undefined || admitted.optional || targetType?.kind !== "named")
    failRustPlannerInvariant("Native type-test selection requires its sealed non-optional dispatch and named target.", node);
  const targetPath = targetType.path;
  const sourceExpression = expression;
  const projected = projectDowncastDispatch(sourceExpression, admitted.route, context);
  if (projected === undefined) return undefined;
  return {
    expression: projected,
    selectedCarrier: fact.targetCarrier,
    selectedValue: (dispatch): RustExpr => ({
      kind: "struct-literal",
      path: targetPath,
      fields: [
        {
          name: rustProjectObjectIdentityField,
          value: cloneProjectField(sourceExpression, rustProjectObjectIdentityField),
        },
        { name: rustProjectObjectDispatchField, value: dispatch },
      ],
    }),
  };
}

function projectDowncastDispatch(
  expression: RustExpr, route: RustProjectDowncastRoute, context: RustPlanContext,
): RustExpr | undefined {
  const receiver = cloneProjectField(expression, rustProjectObjectDispatchField);
  if (route.kind === "checked") {
    const resultType = checkedProjectProjectionResultType(route.targetCarrier, context);
    return resultType === undefined ? undefined
      : planCheckedProjectProjectionCall(receiver, route.slot, resultType);
  }
  return {
    kind: "method-call",
    receiver,
    method: route.slot,
    args: [],
  };
}

function cloneProjectField(expression: RustExpr, field: string): RustExpr {
  return cloneRustExpression({ kind: "field", receiver: expression, name: field });
}
