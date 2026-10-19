import type { Node } from "@tsonic/tsts";
import { planRustAbsentValue, planRustPresentValue } from "../../expressions/optional-storage.js";
import { planRustOptionBranch } from "../../expressions/option-branch.js";
import { rustOptionalStorageValue } from "../../../../target-model/types/projections.js";
import { planRustGenericCallableFlow } from "../../expressions/generic-callable-flow.js";
import { planRustCallableConversion } from "../../expressions/callable-conversions.js";
import type { RustCallableValueAdapter } from "../../../../target-model/records/callable-adapters.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import {
  lowerRustValueConversion,
  planRustProjectUpcast,
} from "../../expressions/index.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustPropagateLocalError } from "../../program/fallible-boundaries.js";
import { rustTargetRuntimeErrorType } from "../../types/error-boundary.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../../names/synthetic.js";
import { planRustEmptyRecordConversion } from "../../expressions/empty-record-conversion.js";
import { planRustProgramErrorConstruction } from "../../expressions/program-errors.js";
import { planRustProjectUnionMapping } from "../../expressions/project-union-mappings.js";
import { planRustProjectStructuralConversion } from "../../objects/project-structural-views.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function applyRustCallableValueAdapter(
  expression: RustExpr,
  adapter: RustCallableValueAdapter,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const raw = applyRustCallableValueAdapterRaw(expression, adapter, node, context);
  if (raw === undefined) {
    return undefined;
  }
  if (!raw.fallible) {
    return raw.expression;
  }
  return context.fallibleBoundary === undefined ? undefined
    : rustPropagateLocalError(context.fallibleBoundary, rustTargetRuntimeErrorType, raw.expression);
}

export function applyRustCallableValueAdapterRaw(
  expression: RustExpr,
  adapter: RustCallableValueAdapter,
  node: Node,
  context: RustPlanContext,
): { readonly expression: RustExpr; readonly fallible: boolean } | undefined {
  switch (adapter.kind) {
    case "absent-completion":
      return { expression: { kind: "evaluate-then", effect: expression, discard: "unit",
        value: planRustAbsentValue(adapter.targetCarrier, context) }, fallible: false };
    case "project-structural-view": {
      const projected = planRustProjectStructuralConversion(expression, adapter.sourceCarrier, adapter.targetCarrier, context);
      return projected === undefined ? undefined : { expression: projected, fallible: false };
    }
    case "identity":
      return { expression, fallible: false };
    case "conversion": {
      if (adapter.upcast !== undefined) {
        const projected = planRustProjectUpcast(node, expression, adapter.upcast, adapter.sourceCarrier, context, "owned");
        if (projected === undefined) return undefined;
        expression = projected;
      }
      if (adapter.lowering.kind === "native") {
        const contract = adapter.lowering.contract;
        const source = contract.sourceMode === "ref" ? { kind: "reference" as const, expr: expression } : expression;
        const converted = lowerRustValueConversion(contract, source, context, node);
        return converted === undefined ? undefined : { expression: converted, fallible: adapter.fallible };
      }
      if (adapter.conversion.kind === "project-union-map") {
        const converted = planRustProjectUnionMapping(node, expression, adapter.conversion,
          adapter.upcast?.targetCarrier ?? adapter.sourceCarrier, adapter.targetCarrier, context, true,
          (value, upcast, owned) => planRustProjectUpcast(node, value, upcast, upcast.sourceCarrier,
            context, owned ? "owned" : "borrowed"));
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "program-error") {
        const converted = planRustProgramErrorConstruction(adapter.conversion, expression, node, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "callable-adapter") {
        const converted = planRustCallableConversion(adapter.conversion, expression, node, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "generic-callable-flow") {
        const converted = planRustGenericCallableFlow(node, adapter.conversion, expression, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "empty-record") {
        const converted = planRustEmptyRecordConversion(adapter.conversion, expression, node, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "provider-record-copy" ||
        adapter.conversion.kind === "integer-truncation") failRustPlannerInvariant(
        "An admitted callable adapter requires its selected compiler lowering.", node);
      if (adapter.conversion.kind === "native-trait-object-upcast" ||
        adapter.conversion.kind === "reference-reborrow") {
        return { expression, fallible: false };
      }
      return failRustPlannerInvariant("An admitted callable conversion requires its exact selected native lowering.", node);
    }
    case "project-upcast": {
      const projected = planRustProjectUpcast(
        node,
        expression,
        {
          sourceCarrier: adapter.sourceCarrier,
          targetCarrier: adapter.targetCarrier,
        },
        adapter.sourceCarrier,
        context,
        "owned",
      );
      return projected === undefined ? undefined : { expression: projected, fallible: false };
    }
    case "call-scoped-lifetime":
      return { expression, fallible: false };
    case "option-some": {
      const element = applyRustCallableValueAdapterRaw(expression, adapter.element, node, context);
      if (element === undefined) {
        return undefined;
      }
      return element.fallible
        ? {
            expression: {
              kind: "method-call",
              receiver: element.expression,
              method: "map",
              args: [{ kind: "closure", params: [{ name: "value", byRefCopy: false }],
                body: planRustPresentValue(adapter.targetCarrier, { kind: "path", path: "value" }, context) }],
            },
            fallible: true,
          }
        : {
            expression: planRustPresentValue(adapter.targetCarrier, element.expression, context),
            fallible: false,
          };
    }
    case "option-map": {
      const names = context.syntheticNames ?? createRustSyntheticNameState(
        context.input.program.source.ast,
        node,
        [],
      );
      const elementName = allocateRustSyntheticName(names, "option_value");
      const element = applyRustCallableValueAdapterRaw(
        { kind: "path", path: elementName },
        adapter.element,
        node,
        context,
      );
      if (element === undefined) {
        return undefined;
      }
      if (rustOptionalStorageValue(adapter.sourceCarrier) !== undefined || rustOptionalStorageValue(adapter.targetCarrier) !== undefined) {
        const absent = planRustAbsentValue(adapter.targetCarrier, context);
        const present = element.fallible ? { kind: "method-call" as const, receiver: element.expression, method: "map",
          args: [{ kind: "closure" as const, params: [{ name: "value", byRefCopy: false }],
            body: planRustPresentValue(adapter.targetCarrier, { kind: "path", path: "value" }, context) }] }
          : planRustPresentValue(adapter.targetCarrier, element.expression, context);
        return { expression: planRustOptionBranch(expression, adapter.sourceCarrier, elementName, present,
          element.fallible ? { kind: "call", path: "Ok", args: [absent] } : absent, context), fallible: element.fallible };
      }
      const mapped: RustExpr = {
        kind: "method-call",
        receiver: expression,
        method: "map",
        args: [{
          kind: "closure",
          params: [{ name: elementName, byRefCopy: false }],
          body: element.expression,
        }],
      };
      return element.fallible
        ? {
            expression: { kind: "method-call", receiver: mapped, method: "transpose", args: [] },
            fallible: true,
          }
        : { expression: mapped, fallible: false };
    }
  }
}
