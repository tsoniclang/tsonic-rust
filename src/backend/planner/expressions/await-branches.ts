import type { Node } from "@tsonic/tsts";
import type { RustAwaitValueFact, RustAwaitValueLeafFact } from "../../../target-model/records/await-values.js";
import { rustAwaitValueRequirements } from "../../../analysis/callables/await-values.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";
import { rustJsPromiseTargetId, isRustNeverCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext, rustUnionTypePathInContext } from "../types/render.js";
import { applyRustLocalErrorBoundary } from "../types/error-boundary.js";
import { rustPropagateNativeError } from "../program/fallible-boundaries.js";
import { rustBottomAfterEffect, rustBottomExpression } from "../types/fallible-shape.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { planRustAbsentValue } from "./optional-storage.js";
import { planRustSourceErrorPropagation } from "./calls/source-errors.js";
import { planRustJsRejectionPropagation } from "./js-rejection.js";
import type { RustSettledPromiseCall } from "../../../target-model/records/callables-and-resources.js";

export function planRustAwaitBranches(
  node: Node,
  expression: RustExpr,
  fact: RustAwaitValueFact,
  context: RustPlanContext,
  settled: RustSettledPromiseCall | undefined,
): RustExpr | undefined {
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const absent = (): RustExpr => isRustUnitCarrier(fact.resultCarrier)
    ? { kind: "tuple-literal", elements: [] } : planRustAbsentValue(fact.resultCarrier, context);
  const leaf = (selected: RustAwaitValueLeafFact, value: RustExpr): RustExpr | undefined => {
    const future = selected.future;
    let output = value;
    if (future !== undefined) {
      const promise = selected.carrier.kind === "target-named" && selected.carrier.id === rustJsPromiseTargetId;
      const requirements = rustAwaitValueRequirements(selected);
      if (requirements.length > 0 && !requireRustCarrierRequirements(future.outputCarrier, requirements, node, context)) return undefined;
      output = settled !== undefined ? value : { kind: "await", expr: promise
        ? { kind: "method-call", receiver: value, method: future.awaiting === "fallible" ? "into_result" : "into_value", args: [] }
        : value };
      if (settled?.fallible === true || settled === undefined && future.awaiting === "fallible") {
        const region = context.fallibleBoundary;
        if (region === undefined) {
          context.diagnostics.push(unsupportedConstructDiagnostic(diagnosticInput(context, node),
            "rust.error.call", "Fallible awaits require a finalized fallible lowering context."));
          return undefined;
        }
        if (future.errorBoundary === "none") {
          context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
            "rust.backend.await-error-boundary", "A finalized fallible Rust future requires one exact error boundary."));
          return undefined;
        }
        const operandError = rustTypeFromCarrierInContext(future.errorCarrier, context);
        const sourceBranches = future.errorBoundary === "source-program"
          ? context.input.program.records.awaitSourceErrorEffects.get(node)?.branches
            .filter(branch => rustTargetTypeRefEquals(branch.carrier, selected.carrier)) : undefined;
        const propagated = future.errorBoundary === "source-program"
          ? sourceBranches?.length !== 1 ? undefined
            : planRustSourceErrorPropagation(node, sourceBranches[0]!.edge, output, context)
          : future.errorBoundary === "source-native"
          ? operandError === undefined || future.errorSource === undefined ? undefined
            : rustPropagateNativeError(region, { identity: future.errorSource, errorType: operandError }, output)
          : future.errorBoundary === "js-rejection" ? planRustJsRejectionPropagation(node, output, context)
          : applyRustLocalErrorBoundary(output, future.errorBoundary, region, operandError);
        if (propagated === undefined) {
          context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
            "rust.backend.await-error-channel", "A fallible await requires its exact selected error channel in the active region."));
          return undefined;
        }
        output = propagated;
      }
      const converted = applyFinalizedValueConversion(context, output, future.awaitedConversion, node);
      if (converted === undefined) return undefined;
      output = isRustNeverCarrier(future.outputCarrier)
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
      const path = `${owner}::${alternative.variant.name}`;
      arms.push({ pattern: constant ? { kind: "path", path }
        : { kind: "tuple-variant", path, elements: [{ kind: "binding", name }] }, expression: selected });
    }
    return { kind: "match", expression: value, arms };
  };
  return plan(fact.selection, expression);
}
