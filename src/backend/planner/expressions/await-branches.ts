import type { Node } from "@tsonic/tsts";
import type { RustAwaitValueFact, RustAwaitValueLeafFact } from "../../../analysis/facts/await-values.js";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";
import { rustJsPromiseTargetId, isRustNeverCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import { diagnosticInput, rustActiveErrorType, type RustPlanContext } from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { rustBottomAfterEffect, rustBottomExpression } from "../types/fallible-shape.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { planRustAbsentValue } from "./optional-storage.js";

export function planRustAwaitBranches(
  node: Node,
  expression: RustExpr,
  fact: RustAwaitValueFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const absent = (): RustExpr => isRustUnitCarrier(fact.resultCarrier)
    ? { kind: "tuple-literal", elements: [] } : planRustAbsentValue(fact.resultCarrier, context);
  const leaf = (selected: RustAwaitValueLeafFact, value: RustExpr): RustExpr | undefined => {
    const future = selected.future;
    let output = value;
    if (future !== undefined) {
      const promise = selected.carrier.kind === "target-named" && selected.carrier.id === rustJsPromiseTargetId;
      if (promise && !requireRustCarrierRequirements(future.outputCarrier, ["clone"], node, context)) return undefined;
      output = { kind: "await", expr: promise
        ? { kind: "method-call", receiver: value, method: future.awaiting === "fallible" ? "into_result" : "into_value", args: [] }
        : value };
      if (future.awaiting === "fallible") {
        const activeErrorType = rustActiveErrorType(context);
        if (activeErrorType === undefined) {
          context.diagnostics.push(unsupportedConstructDiagnostic(diagnosticInput(context, node),
            "rust.error.call", "Fallible awaits require a finalized fallible lowering context."));
          return undefined;
        }
        if (future.errorBoundary === "none") {
          context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
            "rust.backend.await-error-boundary", "A finalized fallible Rust future requires one exact error boundary."));
          return undefined;
        }
        output = applyRustErrorBoundary(output, future.errorBoundary, activeErrorType,
          rustTypeFromCarrierInContext(future.errorCarrier, context));
      }
      const converted = applyFinalizedValueConversion(context, output, future.awaitedConversion, node, "operation-result");
      if (converted === undefined) return undefined;
      output = isRustNeverCarrier(future.outputCarrier)
        ? future.awaiting === "fallible" ? rustBottomAfterEffect(converted, "fallible never await returned")
          : rustBottomExpression(converted)
        : converted;
    }
    return selected.completion.kind === "absence"
      ? { kind: "evaluate-then", effect: output, discard: "unit", value: absent() }
      : applyFinalizedValueConversion(context, output, selected.completion.conversion, node, "operation-result");
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
    const owner = rustTypeFromCarrierInContext(selection.carrier, context);
    if (owner?.kind !== "named") {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.await-union", "Awaited native union has no exact emitted type identity."));
      return undefined;
    }
    const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
    for (const alternative of selection.alternatives) {
      const name = allocateRustSyntheticName(names, "await_value");
      const constant = alternative.variant.kind === "constant";
      const payload: RustExpr = alternative.variant.kind === "constant"
        ? { kind: "bool-literal", value: alternative.variant.value } : { kind: "path", path: name };
      const selected = plan(alternative.selection, payload);
      if (selected === undefined) return undefined;
      const path = `${owner.path}::${alternative.variant.name}`;
      arms.push({ pattern: constant ? { kind: "path", path }
        : { kind: "tuple-variant", path, elements: [{ kind: "binding", name }] }, expression: selected });
    }
    return { kind: "match", expression: value, arms };
  };
  return plan(fact.selection, expression);
}
