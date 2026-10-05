import { rustValueBlock } from "../../target-ast/value-block.js";
import { planRustClosedNativeProjection } from "./closed-native-values.js";
import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustSelectedProjectDowncast } from "../../../analysis/facts/value-projections.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectDowncastRoute } from "../../../analysis/project-types/type-policy.js";
import type { RustProjectTypeTestPlan } from "../../../target-model/operations/type-tests.js";
import { checkedProjectProjectionResultType, planCheckedProjectProjectionCall } from "./checked-project-projections.js";
import type {
  RustProjectDowncastFact,
} from "../../../analysis/facts/keys.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
} from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, sourceTypePath } from "../program/plan-context.js";
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
  const selected = rustSelectedProjectDowncast(context.input.program.facts, node);
  if (!closedMetadataEquals(selected, fact)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.project-downcast", "Project downcast conflicts with its finalized cast or flow evidence."));
    return undefined;
  }
  return planRustProjectProjection(node, expression, fact, context, "borrowed");
}

export function planRustProjectProjection(
  node: Node,
  expression: RustExpr,
  selected: RustProjectDowncastFact,
  context: RustPlanContext,
  ownership: "owned" | "borrowed",
): RustExpr | undefined {
  const { sourceCarrier, dispatchCarrier, targetCarrier } = selected;
  const sourceDefinition = context.input.program.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = context.input.program.projectTypes.definitionForCarrier(targetCarrier);
  const targetType = rustTypeFromCarrierInContext(targetCarrier, context);
  const targetValue = rustSourceTypeCarrierValue(targetCarrier);
  const targetPath = targetValue === undefined
    ? targetType?.kind === "named" ? targetType.path : undefined : sourceTypePath(context, targetValue);
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  const route = sourceDefinition === undefined ? undefined
    : context.input.program.projectTypes.downcastRoute(sourceDefinition, targetCarrier);
  const routeMatches = selected.projection.kind === "generic" || selected.projection.kind === "structural"
    ? true : route?.kind === selected.projection.kind && route.slot === selected.projection.slot;
  if (sourceDefinition === undefined || targetType === undefined || targetPath === undefined ||
    (targetDefinition === undefined && selected.projection.kind !== "structural") || !routeMatches ||
    (!rustTargetTypeRefEquals(sourceCarrier, dispatchCarrier) &&
      !rustTargetTypeRefEquals(optionalElement, dispatchCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-downcast",
      "Project downcast conflicts with its exact source carrier, target carrier, or generated dispatch route.",
    ));
    return undefined;
  }
  if (ownership === "owned") {
    return { kind: "method-call", receiver: { kind: "associated-call", owner: targetType,
      method: "try_from", args: [expression] }, method: "unwrap", args: [] };
  }
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "downcast_value",
  );
  const sourceExpression = planRustNonConsumingProjectValue(node, expression, context);
  const sourceReference: RustExpr = { kind: "reference", expr: sourceExpression };
  const valuePath: RustExpr = optionalElement === undefined
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
  const structuralResultType = selected.projection.kind === "structural"
    ? checkedProjectProjectionResultType(targetCarrier, context) : undefined;
  if (selected.projection.kind === "structural" && structuralResultType === undefined) return undefined;
  const result: RustExpr = selected.projection.kind === "structural"
    ? { kind: "struct-literal", path: targetPath, fields: [{ name: "dispatch", value: {
        kind: "method-call", receiver: planCheckedProjectProjectionCall(
          cloneProjectField(valuePath, rustProjectObjectDispatchField), selected.projection.slot, structuralResultType!),
        method: "unwrap", args: [],
      } }] }
    : selected.projection.kind === "closed"
    ? { kind: "struct-literal", path: targetPath, fields: [
        { name: rustProjectObjectIdentityField, value: cloneProjectField(valuePath, rustProjectObjectIdentityField) },
        { name: rustProjectObjectDispatchField, value: { kind: "method-call", receiver: {
          kind: "method-call", receiver: cloneProjectField(valuePath, rustProjectObjectDispatchField),
          method: selected.projection.slot, args: [],
        }, method: "unwrap", args: [] } },
      ] }
    : { kind: "method-call", receiver: { kind: "associated-call",
        owner: targetType, method: "try_from",
        args: [{ kind: "method-call", receiver: valuePath, method: "clone", args: [] }],
      }, method: "unwrap", args: [] };
  return rustValueBlock([{ name: valueName, value: sourceReference }], result);
}

function planRustNonConsumingProjectValue(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr {
  const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  return !isRustCopyCarrier(carrier) && rustCarrierSupportsClone(carrier, context.input.program.typeDefinitions) &&
      expression.kind === "method-call" && expression.method === "clone" &&
      expression.args.length === 0
    ? expression.receiver
    : expression;
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
  const optionalElement = rustOptionElementCarrier(fact.sourceCarrier);
  if (optionalElement !== undefined) {
    const sourceDefinition = context.input.program.projectTypes.definitionForCarrier(
      fact.dispatchCarrier,
    );
    const route = sourceDefinition === undefined
      ? undefined
      : context.input.program.projectTypes.downcastRoute(sourceDefinition, fact.targetCarrier);
    if (route === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-type-test",
        "Project type test has no exact generated dispatch route for its finalized carriers.",
      ));
      return undefined;
    }
    const projected = projectDowncastDispatch({ kind: "path", path: "value" }, route, context);
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
    return undefined;
  }
  const sourceDefinition = context.input.program.projectTypes.definitionForCarrier(fact.dispatchCarrier);
  const targetDefinition = context.input.program.projectTypes.definitionForCarrier(fact.targetCarrier);
  const route = sourceDefinition === undefined
    ? undefined
    : context.input.program.projectTypes.downcastRoute(sourceDefinition, fact.targetCarrier);
  const targetValue = rustSourceTypeCarrierValue(fact.targetCarrier);
  const targetPath = targetValue === undefined ? undefined : sourceTypePath(context, targetValue);
  if (sourceDefinition === undefined || targetDefinition === undefined || route === undefined ||
    route.target !== targetDefinition || targetPath === undefined ||
    !rustTargetTypeRefEquals(fact.sourceCarrier, fact.dispatchCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-type-test",
      "Project type test conflicts with its exact source carrier, target carrier, or generated dispatch route.",
    ));
    return undefined;
  }
  const sourceExpression = planRustNonConsumingProjectValue(node, expression, context);
  const projected = projectDowncastDispatch(sourceExpression, route, context);
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
  return {
    kind: "method-call",
    receiver: { kind: "field", receiver: expression, name: field },
    method: "clone",
    args: [],
  };
}
