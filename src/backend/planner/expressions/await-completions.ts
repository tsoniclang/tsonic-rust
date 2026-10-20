import type { Node } from "@tsonic/tsts";
import type { RustAwaitValueFact, RustAwaitValueLeafFact } from "../../../target-model/records/await-values.js";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustTypeFromCarrierInContext, rustUnionTypePathInContext } from "../types/render.js";
import { applyRustLocalErrorBoundary } from "../types/error-boundary.js";
import { rustPropagateNativeError } from "../program/fallible-boundaries.js";
import { rustBottomAfterEffect, rustBottomExpression } from "../types/fallible-shape.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { planRustAbsentValue } from "./optional-storage.js";
import { planRustSourceErrorPropagation } from "./calls/source-errors.js";
import { planRustJsRejectionPropagation } from "./js-rejection.js";

export function planRustAwaitBranches(
  node: Node,
  expression: RustExpr,
  fact: RustAwaitValueFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const names = context.syntheticNames;
  if (names === undefined) failRustPlannerInvariant("An admitted await requires its native name scope.", node);
  const result = context.input.program.records.typeEmission.get(fact.resultCarrier);
  if (result === undefined) failRustPlannerInvariant("An admitted await requires its native result completion.", node);
  const absent = (): RustExpr => result.completion === "unit"
    ? { kind: "tuple-literal", elements: [] } : planRustAbsentValue(fact.resultCarrier, context);
  const leaf = (selected: RustAwaitValueLeafFact, value: RustExpr): RustExpr | undefined => {
    const future = selected.future;
    let output = value;
    if (future !== undefined) {
      const carrier = context.input.program.records.typeEmission.get(selected.carrier);
      const completion = context.input.program.records.typeEmission.get(future.outputCarrier);
      if (carrier === undefined || completion === undefined) failRustPlannerInvariant("An admitted future requires its native representation and completion.", node);
      output = { kind: "await", expr: carrier.promiseObject
        ? { kind: "method-call", receiver: value, method: future.awaiting === "fallible" ? "into_result" : "into_value", args: [] }
        : value };
      if (future.awaiting === "fallible") {
        const region = context.fallibleBoundary;
        if (region === undefined) {
          failRustPlannerInvariant("An admitted fallible await requires its native error boundary.", node);
        }
        if (future.errorBoundary === "none") {
          failRustPlannerInvariant("An admitted fallible future requires its selected error channel.", node);
        }
        const operandError = rustTypeFromCarrierInContext(future.errorCarrier, context);
        const sourceEdge = future.errorBoundary === "source-program"
          ? context.input.program.records.awaitErrorEdge.get(node, selected.carrier) : undefined;
        const propagated = future.errorBoundary === "source-program"
          ? sourceEdge === undefined ? undefined : planRustSourceErrorPropagation(node, sourceEdge, output, context)
          : future.errorBoundary === "source-native"
          ? operandError === undefined || future.errorSource === undefined ? undefined
            : rustPropagateNativeError(region, { identity: future.errorSource, errorType: operandError }, output)
          : future.errorBoundary === "js-rejection" ? planRustJsRejectionPropagation(node, output, context)
          : applyRustLocalErrorBoundary(output, future.errorBoundary, region, operandError);
        if (propagated === undefined) {
          failRustPlannerInvariant("An admitted fallible await requires its selected native error propagation.", node);
        }
        output = propagated;
      }
      const converted = applyFinalizedValueConversion(context, output, future.awaitedConversion, node);
      if (converted === undefined) return undefined;
      output = completion.completion === "never"
        ? future.awaiting === "fallible" ? rustBottomAfterEffect(converted, "fallible never await returned")
          : rustBottomExpression(converted)
        : converted;
    }
    return selected.completion.kind === "absence"
      ? { kind: "evaluate-then", effect: output, discard: "unit", value: absent() }
      : applyFinalizedValueConversion(context, output, selected.completion.conversion, node);
  };
  const plan = (selection: RustAwaitSelection<RustAwaitValueLeafFact>, value: RustExpr): RustExpr | undefined => {
    if (selection.kind === "leaf") return leaf(selection.value, value);
    if (selection.kind === "optional") {
      const name = allocateRustSyntheticName(names, "future");
      const present = plan(selection.present, { kind: "path", path: name });
      return present === undefined ? undefined : { kind: "match", expression: value, arms: [
        { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] }, expression: present },
        { pattern: { kind: "path", path: "None" }, expression: absent() },
      ] };
    }
    const owner = rustUnionTypePathInContext(selection.carrier, context);
    if (owner === undefined) {
      failRustPlannerInvariant("An admitted awaited union requires its native type identity.", node);
    }
    const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
    for (const alternative of selection.alternatives) {
      const name = allocateRustSyntheticName(names, "await_value");
      const constant = alternative.variant.kind === "constant";
      const payload: RustExpr = alternative.variant.kind === "constant"
        ? { kind: "bool-literal", value: alternative.variant.value } : { kind: "path", path: name };
      const selected = plan(alternative.selection, payload);
      if (selected === undefined) return undefined;
      const path = `${owner}::${alternative.variant.name}`;
      arms.push({ pattern: constant ? { kind: "path", path }
        : { kind: "tuple-variant", path, elements: [{ kind: "binding", name }] }, expression: selected });
    }
    return { kind: "match", expression: value, arms };
  };
  return plan(fact.selection, expression);
}
