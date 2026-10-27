import type { Node } from "@tsonic/tsts";
import type { RustFlowReadProjectionFact } from "../../../target-model/records/objects/value-projections.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustSourcePackageErrorRoute } from "../../../target-model/records/errors/source-package-errors.js";
import { checkedProjectProjectionResultType, planCheckedProjectProjectionCall } from "../objects/checked-project-projections.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustAutoBorrowedReceiver } from "./auto-borrowed-receivers.js";

type RustProgramErrorTypeTestFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "program-error-type-test" }
>;

type RustProgramErrorFlowReadFact = Extract<
  RustFlowReadProjectionFact,
  { readonly kind: "program-error-variant" }
>;

export function planRustProgramErrorEquality(
  node: Node,
  left: RustExpr,
  right: RustExpr,
  fact: Extract<RustTargetOperationFact, { readonly kind: "program-error-equality" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const builtin = fact.comparison.kind === "builtin";
  const view = errorView(fact.sourceCarrier, context);
  const route = fact.comparison.kind === "project"
    ? resolveProgramErrorFactRoute(fact.targetCarrier, fact.comparison.variant, context)
    : undefined;
  if (!builtin && route === undefined) failRustPlannerInvariant("Program-error equality requires its exact closed error variant.", node);
  const boundary = view.kind === "program" ? rustCurrentErrorBoundary(context) : undefined;
  if (view.kind === "program" && boundary === undefined) failRustPlannerInvariant("Program-error equality requires its exact native error domain.", node);
  context.usedAliases?.add("rt");
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted Error equality requires its hygienic native scope.", node);
  const valueName = allocateRustSyntheticName(names, "error_value");
  const otherName = allocateRustSyntheticName(names, "compared_value");
  const errorPattern: RustPattern = builtin
    ? { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: valueName }] }
    : programErrorPattern(route!, { kind: "binding", name: valueName }, view.kind === "source");
  const otherPattern: RustPattern = { kind: "binding", name: otherName };
  const operand = (value: RustExpr, side: "left" | "right"): RustExpr => {
    if (fact.errorOperand === side) {
      if (builtin) {
        if (view.kind === "closed") {
          return { kind: "method-call", receiver: value, method: "as_error", args: [] };
        }
        const observed = view.observed;
        const source: RustExpr = observed
          ? { kind: "reference", expr: value }
          : { kind: "method-call", receiver: value, method: "source_error", args: [] };
        return observed || boundary?.errorDomain === "runtime"
          ? { kind: "call", path: "Some", args: [source] } : source;
      }
      return programErrorSubject(value, fact.sourceCarrier, false, context);
    }
    return { kind: "reference", expr: value };
  };
  return {
    kind: "match",
    expression: { kind: "tuple-literal", elements: [
      operand(left, "left"),
      operand(right, "right"),
    ] },
    arms: [
      {
        pattern: { kind: "tuple", elements: fact.errorOperand === "left"
          ? [errorPattern, otherPattern] : [otherPattern, errorPattern] },
        expression: builtin ? {
          kind: "binary", operator: fact.negated ? "!=" : "==",
          left: { kind: "call", path: "rt::ErrorObject::error_identity_key", args: [{ kind: "path", path: valueName }] },
          right: { kind: "call", path: "rt::ErrorObject::error_identity_key", args: [{ kind: "path", path: otherName }] },
        } : projectErrorPayload(route!, fact.sourceCarrier, { kind: "path", path: valueName }, false, payload =>
          ({ kind: "binary", left: payload, operator: fact.negated ? "!=" : "==", right: { kind: "path", path: otherName } }),
          { kind: "bool-literal", value: fact.negated }, context),
      },
      { pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: fact.negated } },
    ],
  };
}

export function planRustProgramErrorTypeTest(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorTypeTestFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const view = errorView(fact.sourceCarrier, context);
  const element = view.optional;
  if (element !== undefined) {
    const name = allocateRustSyntheticName(context.syntheticNames ?? failRustPlannerInvariant("An admitted optional Error test requires its hygienic scope.", node), "optional_error");
    const selected = planRustProgramErrorTypeTest(node, { kind: "path", path: name }, { ...fact, sourceCarrier: element }, context);
    return selected === undefined ? undefined : { kind: "method-call",
      receiver: { kind: "method-call", receiver: rustAutoBorrowedReceiver(expression), method: "as_ref", args: [] }, method: "is_some_and",
      args: [{ kind: "closure", params: [{ name, byRefCopy: false }], body: selected }] };
  }
  const route = resolveProgramErrorFactRoute(
    fact.targetCarrier,
    fact.variant,
    context,
  );
  if (route === undefined) {
    failRustPlannerInvariant("Program-error type test requires its exact closed error variant.", node);
  }
  context.usedAliases?.add("rt");
  const projectable = errorProjectable(fact.targetCarrier, context);
  const projection = (value: RustExpr): RustExpr | undefined => {
    if (!projectable) {
      return { kind: "bool-literal", value: false };
    }
    const selected = planCheckedErrorDispatch(value, fact.targetCarrier, context, false);
    return selected === undefined ? undefined : { kind: "option-presence", receiver: selected, present: true };
  };
  if (view.kind === "retained") return projection(expression);
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted Error test requires its hygienic native scope.", node);
  const otherName = allocateRustSyntheticName(names, "retained_error");
  const otherwise = projection({ kind: "path", path: otherName });
  if (otherwise === undefined) return undefined;
  if (!projectable) {
    return { kind: "matches", expression: programErrorSubject(expression, fact.sourceCarrier, false, context),
      pattern: programErrorPattern(route, { kind: "wildcard" }, view.kind === "source") };
  }
  if (view.kind === "closed") {
    return { kind: "method-call", receiver: { kind: "method-call", receiver: expression, method: "as_error", args: [] },
      method: "is_some_and", args: [{ kind: "closure", params: [{ name: otherName, byRefCopy: false }], body: otherwise }] };
  }
  if (route.kind === "local") {
    return { kind: "match", expression: programErrorSubject(expression, fact.sourceCarrier, false, context), arms: [
      { pattern: programErrorPattern(route, { kind: "wildcard" }, view.kind === "source"),
        expression: { kind: "bool-literal", value: true } },
      { pattern: { kind: "binding", name: otherName }, expression: otherwise },
    ] };
  }
  const valueName = allocateRustSyntheticName(names, "error_package");
  const externalFallback = projection({ kind: "path", path: valueName });
  if (externalFallback === undefined) return undefined;
  return { kind: "match", expression: programErrorSubject(expression, fact.sourceCarrier, false, context), arms: [
    { pattern: programErrorPattern(route, { kind: "binding", name: valueName }, view.kind === "source"),
      expression: projectErrorPayload(route, fact.sourceCarrier, { kind: "path", path: valueName }, false,
        { kind: "bool-literal", value: true }, externalFallback, context) },
    { pattern: { kind: "binding", name: otherName }, expression: otherwise },
  ] };
}

export function planRustProgramErrorFlowRead(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorFlowReadFact,
  context: RustPlanContext,
  ownsValue: boolean,
): RustExpr | undefined {
  const route = resolveProgramErrorFactRoute(
    fact.selectedCarrier,
    fact.variant,
    context,
  );
  if (route === undefined) {
    failRustPlannerInvariant("Program-error flow projection requires its exact closed error variant.", node);
  }
  context.usedAliases?.add("rt");
  const projectable = errorProjectable(fact.selectedCarrier, context);
  const recovered = (value: RustExpr): RustExpr | undefined => {
    if (!projectable) {
      return { kind: "unreachable", message: "checked flow selected a different nominal thrown value" };
    }
    const projected = planCheckedErrorDispatch(value, fact.selectedCarrier, context, ownsValue);
    const type = rustTypeFromCarrierInContext(fact.selectedCarrier, context);
    if (projected === undefined || type?.kind !== "named") failRustPlannerInvariant("An admitted Error flow projection requires its exact named native wrapper.", node);
    return rustValueBlock([{ name: "error_dispatch", value: { kind: "method-call", receiver: projected,
      method: "expect", args: [{ kind: "str-literal", value: "checked flow selected a different native Error origin" }] } }],
    { kind: "struct-literal", path: type.path, fields: [
      { name: "identity", value: { kind: "method-call", receiver: { kind: "call", path: "rt::ObjectIdentityCarrier::object_identity",
        args: [{ kind: "method-call", receiver: { kind: "path", path: "error_dispatch" }, method: "as_ref", args: [] }] },
        method: "clone", args: [] } },
      { name: "dispatch", value: { kind: "path", path: "error_dispatch" } },
    ] });
  };
  const source = errorView(fact.sourceCarrier, context);
  const dispatchCarrier = source.optional ?? fact.sourceCarrier;
  const dispatch = errorView(dispatchCarrier, context);
  if (dispatch.kind === "closed") {
    const value = source.optional === undefined ? expression
      : programErrorSubject(expression, fact.sourceCarrier, ownsValue, context);
    return recovered({ kind: "method-call", receiver: {
      kind: "method-call", receiver: value, method: ownsValue ? "into_error" : "as_error", args: [],
    }, method: "expect", args: [{ kind: "str-literal", value: "exact checked flow selected a non-Error payload" }] });
  }
  if (dispatch.kind === "retained") return recovered(source.optional === undefined
    ? expression : programErrorSubject(expression, fact.sourceCarrier, ownsValue, context));
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted Error flow projection requires its native hygienic scope.", node);
  const otherName = allocateRustSyntheticName(names, "retained_error");
  const otherwise = recovered({ kind: "path", path: otherName });
  if (otherwise === undefined) return undefined;
  const valueName = allocateRustSyntheticName(
    names,
    "program_error",
  );
  const externalFallback = recovered({ kind: "path", path: valueName });
  if (externalFallback === undefined) return undefined;
  return {
    kind: "match",
    expression: programErrorSubject(expression, fact.sourceCarrier, ownsValue, context),
    arms: [
      {
        pattern: programErrorPattern(route, { kind: "binding", name: valueName }, dispatch.kind === "source"),
        expression: projectErrorPayload(route, fact.sourceCarrier, { kind: "path", path: valueName }, ownsValue,
          payload => ownsValue ? payload : {
          kind: "method-call",
          receiver: payload,
          method: "clone",
          args: [],
        }, externalFallback, context),
      },
      { pattern: !projectable ? { kind: "wildcard" } : { kind: "binding", name: otherName }, expression: otherwise },
    ],
  };
}

function resolveProgramErrorFactRoute(
  targetCarrier: RustProgramErrorTypeTestFact["targetCarrier"],
  variant: string,
  context: RustPlanContext,
): RustSourcePackageErrorRoute | undefined {
  const definition = context.input.program.records.projectType.get(targetCarrier);
  if (definition === undefined) failRustPlannerInvariant("An admitted Error projection requires its exact nominal source definition.", context.callableDeclaration ?? context.sourceFile);
  return context.input.program.records.programErrorRoute.get(context.sourcePackageComponentId, definition, variant);
}

function planCheckedErrorDispatch(
  expression: RustExpr, carrier: TargetTypeRef, context: RustPlanContext, owned: boolean,
): RustExpr | undefined {
  const result = checkedProjectProjectionResultType(carrier, context);
  if (result === undefined) failRustPlannerInvariant("An admitted native Error dispatch requires its selected projection result.", context.callableDeclaration ?? context.sourceFile);
  return planCheckedProjectProjectionCall(expression,
    owned ? "into_project_error" : "project_error", result);
}

function programErrorPattern(
  route: RustSourcePackageErrorRoute,
  payload: RustPattern,
  admitted: boolean,
): RustPattern {
  if (route.kind === "local") {
    return {
      kind: "tuple-variant",
      path: `rt::ErrorTransport::${route.variant}`,
      elements: [payload],
    };
  }
  return {
    kind: "tuple-variant",
    path: `rt::ErrorTransport::${route.consumerVariant}`,
    elements: admitted ? [payload] : [{
      kind: "tuple-variant",
      path: `${route.ownerTypePath}::${route.ownerVariant}`,
      elements: [payload],
    }],
  };
}

function programErrorSubject(expression: RustExpr, carrier: TargetTypeRef, owned: boolean, context: RustPlanContext): RustExpr {
  const element = errorView(carrier, context).optional;
  if (element !== undefined) {
    expression = { kind: "method-call", receiver: owned ? expression : { kind: "method-call", receiver: expression,
      method: "as_ref", args: [] }, method: "expect", args: [{ kind: "str-literal", value: "checked flow selected an absent Error" }] };
    carrier = element;
  }
  return errorView(carrier, context).kind === "source" ? { kind: "method-call", receiver: expression,
    method: owned ? "into_admitted_transport" : "as_transport", args: [] }
    : owned ? expression : { kind: "reference", expr: expression };
}

function projectErrorPayload(
  route: RustSourcePackageErrorRoute, carrier: TargetTypeRef, value: RustExpr, owned: boolean,
  project: RustExpr | ((payload: RustExpr) => RustExpr), otherwise: RustExpr, context: RustPlanContext,
): RustExpr {
  carrier = errorView(carrier, context).optional ?? carrier;
  if (route.kind === "local" || errorView(carrier, context).kind !== "source") return typeof project === "function" ? project(value) : project;
  return { kind: "match", expression: programErrorSubject(value, carrier, owned, context), arms: [
    { pattern: { kind: "tuple-variant", path: `${route.ownerTransportTypePath}::${route.ownerVariant}`,
      elements: [typeof project === "function" ? { kind: "binding", name: "error_payload" } : { kind: "wildcard" }] },
      expression: typeof project === "function" ? project({ kind: "path", path: "error_payload" }) : project },
    { pattern: { kind: "wildcard" }, expression: otherwise },
  ] };
}

function errorView(carrier: TargetTypeRef, context: RustPlanContext) {
  return context.input.program.records.typeEmission.get(carrier)?.errorView
    ?? failRustPlannerInvariant("An admitted Error observation requires its exact sealed native subject form.", context.callableDeclaration ?? context.sourceFile);
}

function errorProjectable(carrier: TargetTypeRef, context: RustPlanContext): boolean {
  const definition = context.input.program.records.projectType.get(carrier);
  const selected = definition === undefined ? undefined : context.input.program.records.projectError.get(definition);
  if (selected === undefined) failRustPlannerInvariant("An admitted Error projection requires its exact native source-error eligibility.", context.callableDeclaration ?? context.sourceFile);
  return selected.sourceError;
}
