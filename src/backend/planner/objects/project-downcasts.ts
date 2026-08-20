import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { TargetTypeRef } from "../../../policy/types/model.js";
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
import type { RustExpr } from "../../rust-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, sourceTypePath } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
} from "./project-objects.js";
import { rustProjectRootType } from "./polymorphism/names.js";
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
  const sourceDefinition = context.input.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = context.input.projectTypes.definitionForCarrier(targetCarrier);
  const route = sourceDefinition === undefined
    ? undefined
    : context.input.projectTypes.downcastRoute(sourceDefinition, targetCarrier);
  const targetValue = rustSourceTypeCarrierValue(targetCarrier);
  const targetPath = targetValue === undefined ? undefined : sourceTypePath(context, targetValue);
  const targetRootType = rustProjectRootType(targetCarrier, context);
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (sourceDefinition === undefined || targetDefinition === undefined || route === undefined ||
    route.target !== targetDefinition || targetPath === undefined || targetRootType === undefined ||
    (!rustTargetTypeRefEquals(sourceCarrier, dispatchCarrier) &&
      !rustTargetTypeRefEquals(optionalElement, dispatchCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-downcast",
      "Project downcast conflicts with its exact source carrier, target carrier, or concrete Rust identity route.",
    ));
    return undefined;
  }
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.ast, node, []),
    "downcast_value",
  );
  const sourceExpression = planRustNonConsumingProjectValue(node, expression, context);
  context.usedAliases?.add("rt");
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
            receiver: projectDowncastRoot(valuePath, targetRootType),
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
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
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
  const sourceDefinition = context.input.projectTypes.definitionForCarrier(fact.dispatchCarrier);
  const route = sourceDefinition === undefined
    ? undefined
    : context.input.projectTypes.downcastRoute(sourceDefinition, fact.targetCarrier);
  const targetRootType = rustProjectRootType(fact.targetCarrier, context);
  if (route === undefined || targetRootType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-type-test",
      "Project type test has no exact concrete Rust identity route for its finalized carriers.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
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
          receiver: projectObjectAny({ kind: "path", path: "value" }),
          method: "is",
          typeArguments: [targetRootType],
          args: [],
        },
      }],
    };
  }
  return {
    kind: "method-call",
    receiver: projectObjectAny(expression),
    method: "is",
    typeArguments: [targetRootType],
    args: [],
  };
}

function projectObjectAny(expression: RustExpr): RustExpr {
  return {
    kind: "method-call",
    receiver: cloneProjectField(expression, rustProjectObjectDispatchField),
    method: "into_any",
    args: [],
  };
}

function projectDowncastRoot(expression: RustExpr, targetRootType: import("../../rust-ast/nodes.js").RustType): RustExpr {
  return {
    kind: "method-call",
    receiver: projectObjectAny(expression),
    method: "downcast",
    typeArguments: [targetRootType],
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
