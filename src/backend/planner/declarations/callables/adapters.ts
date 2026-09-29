import type { Node } from "@tsonic/tsts";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { planRustGenericCallableFlow } from "../../expressions/generic-callable-flow.js";
import { planRustCallableAbsenceCompletion } from "../../expressions/callable-completion.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type {
  RustCallableValueAdapter,
} from "../../../../analysis/facts/keys.js";
import { rustValueConversionContract } from "../../../../target-model/conversions/contracts.js";
import {
  isRustUnitCarrier,
  rustOptionElementCarrier,
} from "../../../../target-model/types/index.js";
import type { RustExpr } from "../../../target-ast/nodes.js";
import {
  lowerRustValueConversion,
  planRustProjectUpcast,
} from "../../expressions/index.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustActiveErrorType } from "../../program/plan-context.js";
import { rustTargetRuntimeErrorType } from "../../types/error-boundary.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../../names/synthetic.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../../../target-model/conversions/contextual.js";
import { planRustEmptyRecordConversion } from "../../expressions/empty-record-conversion.js";
import { planRustProgramErrorConstruction } from "../../expressions/program-errors.js";
import { planRustProjectStructuralConversion } from "../../objects/project-structural-views.js";

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
  const activeErrorType = rustActiveErrorType(context);
  return activeErrorType !== undefined
    ? {
        kind: "try",
        expr: raw.expression,
        resultErrorType: activeErrorType,
        operandErrorType: rustTargetRuntimeErrorType,
      }
    : undefined;
}

export function applyRustCallableValueAdapterRaw(
  expression: RustExpr,
  adapter: RustCallableValueAdapter,
  node: Node,
  context: RustPlanContext,
): { readonly expression: RustExpr; readonly fallible: boolean } | undefined {
  switch (adapter.kind) {
    case "absent-completion":
      return isRustUnitCarrier(adapter.sourceCarrier) && rustOptionElementCarrier(adapter.targetCarrier) !== undefined
        ? { expression: { kind: "evaluate-then", effect: expression, discard: "unit",
            value: planRustAbsentValue(adapter.targetCarrier, context) }, fallible: false } : undefined;
    case "project-structural-view": {
      const projected = planRustProjectStructuralConversion(expression, adapter.sourceCarrier, adapter.targetCarrier, context);
      return projected === undefined ? undefined : { expression: projected, fallible: false };
    }
    case "identity":
      return rustTargetTypeRefEquals(adapter.sourceCarrier, adapter.targetCarrier)
        ? { expression, fallible: false }
        : undefined;
    case "conversion": {
      if (adapter.conversion.kind === "program-error") {
        if (!rustCompilerOwnedContextualConversionMatches(adapter.sourceCarrier, adapter.targetCarrier, adapter.conversion)) return undefined;
        const converted = planRustProgramErrorConstruction(adapter.conversion, expression, node, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "callable-absence-completion") {
        if (!rustCompilerOwnedContextualConversionMatches(adapter.sourceCarrier, adapter.targetCarrier, adapter.conversion)) return undefined;
        const converted = planRustCallableAbsenceCompletion(adapter.conversion, expression, node, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "generic-callable-flow") {
        const converted = planRustGenericCallableFlow(adapter.conversion, expression, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "empty-record") {
        const converted = planRustEmptyRecordConversion(adapter.conversion, expression, node, context);
        return converted === undefined ? undefined : { expression: converted, fallible: false };
      }
      if (adapter.conversion.kind === "provider-record-copy" ||
        adapter.conversion.kind === "integer-truncation") return undefined;
      if (adapter.conversion.kind === "native-trait-object-upcast" ||
        adapter.conversion.kind === "reference-reborrow") {
        return rustCompilerOwnedContextualConversionMatches(
          adapter.sourceCarrier,
          adapter.targetCarrier,
          adapter.conversion, context.input.program.typeDefinitions,
        )
          ? { expression, fallible: false }
          : undefined;
      }
      const contract = rustValueConversionContract(adapter.conversion, context.input.program.typeDefinitions);
      if (contract === undefined ||
        !rustTargetTypeRefEquals(contract.source, adapter.sourceCarrier) ||
        !rustTargetTypeRefEquals(contract.target, adapter.targetCarrier)) {
        return undefined;
      }
      const source = contract.sourceMode === "ref"
        ? { kind: "reference" as const, expr: expression }
        : expression;
      const converted = lowerRustValueConversion(contract, source, context, node);
      return converted === undefined
        ? undefined
        : { expression: converted, fallible: contract.fallible };
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
              args: [{ kind: "path", path: "Some" }],
            },
            fallible: true,
          }
        : {
            expression: { kind: "call", path: "Some", args: [element.expression] },
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
