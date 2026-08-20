import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type {
  RustProjectDowncastFact,
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
} from "../../../policy/types/target-types.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, sourceTypePath } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
} from "./project-objects.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

type RustProjectTypeTestFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "project-type-test" }
>;

export function planRustProjectDowncast(
  node: Node,
  expression: RustExpr,
  fact: RustProjectDowncastFact,
  context: RustPlanContext,
): RustExpr | undefined {
  return planRustProjectDowncastValue(
    node,
    expression,
    fact.sourceCarrier,
    fact.dispatchCarrier,
    fact.targetCarrier,
    context,
  );
}

export function planRustProjectDowncastValue(
  node: Node,
  expression: RustExpr,
  sourceCarrier: TargetTypeRef,
  dispatchCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceDefinition = context.input.program.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = context.input.program.projectTypes.definitionForCarrier(targetCarrier);
  const route = sourceDefinition === undefined
    ? undefined
    : context.input.program.projectTypes.downcastRoute(sourceDefinition, targetCarrier);
  const targetValue = rustSourceTypeCarrierValue(targetCarrier);
  const targetPath = targetValue === undefined ? undefined : sourceTypePath(context, targetValue);
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (sourceDefinition === undefined || targetDefinition === undefined || route === undefined ||
    route.target !== targetDefinition || targetPath === undefined ||
    (!rustTargetTypeRefEquals(sourceCarrier, dispatchCarrier) &&
      !rustTargetTypeRefEquals(optionalElement, dispatchCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-downcast",
      "Project downcast conflicts with its exact source carrier, target carrier, or generated dispatch route.",
    ));
    return undefined;
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
  return {
    kind: "block",
    bindings: [{ name: valueName, value: sourceReference }],
    value: {
      kind: "struct-literal",
      path: targetPath,
      fields: [
        {
          name: rustProjectObjectIdentityField,
          value: cloneProjectField(valuePath, rustProjectObjectIdentityField),
        },
        {
          name: rustProjectObjectDispatchField,
          value: {
            kind: "method-call",
            receiver: projectDowncastDispatch(valuePath, route.slot),
            method: "unwrap",
            args: [],
          },
        },
      ],
    },
  };
}

function planRustNonConsumingProjectValue(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr {
  const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  return !isRustCopyCarrier(carrier) && rustCarrierSupportsClone(carrier) &&
      expression.kind === "method-call" && expression.method === "clone" &&
      expression.args.length === 0
    ? expression.receiver
    : expression;
}

export function planRustProjectTypeTest(
  node: Node,
  expression: RustExpr,
  fact: RustProjectTypeTestFact,
  context: RustPlanContext,
): RustExpr | undefined {
  if (fact.lowering.kind === "constant") {
    return {
      kind: "evaluate-then",
      effect: expression,
      discard: "value",
      value: { kind: "bool-literal", value: fact.lowering.value },
    };
  }
  if (fact.lowering.kind === "option-presence") {
    return { kind: "method-call", receiver: expression, method: "is_some", args: [] };
  }
  const sourceDefinition = context.input.program.projectTypes.definitionForCarrier(fact.dispatchCarrier);
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
  const optionalElement = rustOptionElementCarrier(fact.sourceCarrier);
  if (optionalElement !== undefined) {
    return {
      kind: "method-call",
      receiver: { kind: "method-call", receiver: expression, method: "as_ref", args: [] },
      method: "is_some_and",
      args: [{
        kind: "closure",
        params: [{ name: "value", byRefCopy: false }],
        body: {
          kind: "method-call",
          receiver: projectDowncastDispatch({ kind: "path", path: "value" }, route.slot),
          method: "is_some",
          args: [],
        },
      }],
    };
  }
  return {
    kind: "method-call",
    receiver: projectDowncastDispatch(expression, route.slot),
    method: "is_some",
    args: [],
  };
}

function projectDowncastDispatch(expression: RustExpr, slot: string): RustExpr {
  return {
    kind: "method-call",
    receiver: cloneProjectField(expression, rustProjectObjectDispatchField),
    method: slot,
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
