import type { Node } from "@tsonic/tsts";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { planRustGenericCallableFlow } from "../../expressions/generic-callable-flow.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type {
  RustCallableParameterAbi,
  RustCallableParameterAdapter,
  RustCallableValueAdapter,
} from "../../../../analysis/facts/keys.js";
import { rustValueConversionContract } from "../../../../target-model/conversions/contracts.js";
import {
  isRustCopyCarrier,
  isRustStringCarrier,
  isRustVecCarrier,
  rustCarrierSupportsClone,
} from "../../../../target-model/types/index.js";
import type { RustExpr, RustFunctionParam, RustStmt, RustType } from "../../../target-ast/nodes.js";
import {
  lowerRustValueConversion,
  planRustProjectUpcast,
} from "../../expressions/index.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustActiveErrorType } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustTargetRuntimeErrorType } from "../../types/error-boundary.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../../names/synthetic.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../../../target-model/conversions/contextual.js";
import { planRustEmptyRecordConversion } from "../../expressions/empty-record-conversion.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { planRustProjectStructuralConversion } from "../../objects/project-structural-views.js";
import { planRustParameterEntryValue } from "./parameter-entry-conversion.js";

export function planRustCallableArguments(
  input: {
    readonly declaration: Node;
    readonly parameters: readonly RustFunctionParam[];
    readonly parameterAbis: readonly RustCallableParameterAbi[];
    readonly parameterAdapters: readonly RustCallableParameterAdapter[];
  },
  context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly adaptedArguments: readonly RustExpr[] } | undefined {
  if (input.parameters.length !== input.parameterAbis.length) {
    return undefined;
  }
  const statements: RustStmt[] = [];
  const adaptedArguments: RustExpr[] = [];
  const parameterExpression = (index: number): RustExpr | undefined => {
    const parameter = input.parameters[index];
    return parameter === undefined ? undefined : { kind: "path", path: parameter.name };
  };
  for (const [implementationIndex, adapter] of input.parameterAdapters.entries()) {
    if (adapter.kind === "omitted") {
      if (implementationIndex < input.parameterAbis.length) return undefined;
    } else if (adapter.kind === "fixed-rest") {
      if (adapter.contractParameterIndexes.length !== Math.max(0, input.parameterAbis.length - implementationIndex) ||
        adapter.contractParameterIndexes.some((index, offset) => index !== implementationIndex + offset ||
          !closedMetadataEquals(adapter.sources[offset], input.parameterAbis[index]))) return undefined;
    } else if (adapter.contractParameterIndex !== implementationIndex ||
      !closedMetadataEquals(adapter.source, input.parameterAbis[implementationIndex]) ||
      adapter.kind === "sequence-rest" && implementationIndex !== input.parameterAbis.length - 1) {
      return undefined;
    }
    if (adapter.kind === "omitted") {
      if (adapter.target.form === "optional" || adapter.target.form === "default") {
        adaptedArguments.push(planRustAbsentValue(adapter.target.parameterCarrier, context));
        continue;
      }
      return undefined;
    }
    if (adapter.kind === "fixed-rest") {
      if (!isRustVecCarrier(adapter.target.parameterCarrier) ||
        adapter.contractParameterIndexes.length !== adapter.sources.length ||
        adapter.sources.length !== adapter.elementAdapters.length) {
        return undefined;
      }
      const elements: RustExpr[] = [];
      for (const [index, contractParameterIndex] of adapter.contractParameterIndexes.entries()) {
        const source = adapter.sources[index];
        const valueAdapter = adapter.elementAdapters[index];
        if (source === undefined || valueAdapter === undefined) {
          return undefined;
        }
        const expression = parameterExpression(contractParameterIndex);
        const logical = expression === undefined
          ? undefined
          : readRustCallableLogicalParameter(expression, source, context);
        const adapted = logical === undefined
          ? undefined
          : applyRustCallableValueAdapter(
              logical,
              valueAdapter,
              input.declaration,
              context,
            );
        if (adapted === undefined) {
          return undefined;
        }
        elements.push(adapted);
      }
      adaptedArguments.push({ kind: "vec-literal", elements });
      continue;
    }
    if (adapter.kind === "sequence-rest") {
      const source = parameterExpression(adapter.contractParameterIndex);
      const targetType = rustTypeFromCarrierInContext(adapter.target.parameterCarrier, context);
      if (source === undefined || targetType === undefined ||
        !isRustVecCarrier(adapter.source.parameterCarrier) ||
        !isRustVecCarrier(adapter.target.parameterCarrier)) {
        return undefined;
      }
      if (adapter.elementAdapter.kind === "identity") {
        adaptedArguments.push(source);
        continue;
      }
      const names = context.syntheticNames ?? createRustSyntheticNameState(
        context.input.program.source.ast,
        input.declaration,
        [],
      );
      const elementName = allocateRustSyntheticName(names, "rest_element");
      const raw = applyRustCallableValueAdapterRaw(
        { kind: "path", path: elementName },
        adapter.elementAdapter,
        input.declaration,
        context,
      );
      if (raw === undefined) {
        return undefined;
      }
      const mapped: RustExpr = {
        kind: "method-call",
        receiver: {
          kind: "method-call",
          receiver: source,
          method: "into_iter",
          args: [],
        },
        method: "map",
        args: [{
          kind: "closure",
          params: [{ name: elementName, byRefCopy: false }],
          body: raw.expression,
        }],
      };
      const collectionType: RustType = raw.fallible
          ? {
            kind: "named",
            path: "Result",
            genericArguments: [
              { kind: "type", type: targetType },
              { kind: "type", type: rustTargetRuntimeErrorType },
            ],
          }
        : targetType;
      if (raw.fallible) {
        context.usedAliases?.add("rt");
      }
      const collected: RustExpr = {
        kind: "method-call",
        receiver: mapped,
        method: "collect",
        genericArguments: [{ kind: "type", type: collectionType }],
        args: [],
      };
      const activeErrorType = rustActiveErrorType(context);
      if (raw.fallible && activeErrorType === undefined) {
        return undefined;
      }
      adaptedArguments.push(raw.fallible
        ? {
            kind: "try",
            expr: collected,
            resultErrorType: activeErrorType!,
            operandErrorType: rustTargetRuntimeErrorType,
          }
        : collected);
      continue;
    }
    const sourceExpression = parameterExpression(adapter.contractParameterIndex);
    if (sourceExpression === undefined) {
      return undefined;
    }
    if (adapter.kind === "runtime-value") {
      const adapted = applyRustCallableValueAdapter(
        sourceExpression,
        adapter.adapter,
        input.declaration,
        context,
      );
      if (adapted === undefined) {
        return undefined;
      }
      adaptedArguments.push(adapted);
      continue;
    }
    const logical = readRustCallableLogicalParameter(sourceExpression, adapter.source, context);
    const adapted = logical === undefined
      ? undefined
      : applyRustCallableValueAdapter(
          logical,
          adapter.adapter,
          input.declaration,
          context,
        );
    if (adapted === undefined) {
      return undefined;
    }
    if (adapter.target.form === "optional" || adapter.target.form === "default") {
      adaptedArguments.push({ kind: "call", path: "Some", args: [adapted] });
      continue;
    }
    if (adapter.target.mode === "value") {
      adaptedArguments.push(adapted);
      continue;
    }
    if (adapter.target.mode === "ref") {
      adaptedArguments.push({ kind: "reference", expr: adapted });
      continue;
    }
    const names = context.syntheticNames ?? createRustSyntheticNameState(
      context.input.program.source.ast,
      input.declaration,
      [],
    );
    const bindingName = allocateRustSyntheticName(names, "adapted_argument");
    statements.push({
      kind: "let",
      name: bindingName,
      mutable: true,
      init: adapted,
    });
    adaptedArguments.push({
      kind: "reference",
      expr: { kind: "path", path: bindingName },
      mutable: true,
    });
  }
  return {
    statements: Object.freeze(statements),
    adaptedArguments: Object.freeze(adaptedArguments),
  };
}

function readRustCallableLogicalParameter(
  expression: RustExpr,
  abi: RustCallableParameterAbi,
  context: RustPlanContext,
): RustExpr | undefined {
  if (abi.mode === "value") {
    return planRustParameterEntryValue(abi, expression, undefined, context);
  }
  if (isRustStringCarrier(abi.valueCarrier)) {
    return { kind: "owned-string-from-borrowed-str", expression };
  }
  const value: RustExpr = { kind: "dereference", pointer: expression };
  if (isRustCopyCarrier(abi.valueCarrier)) {
    return value;
  }
  return rustCarrierSupportsClone(abi.valueCarrier, context.input.program.typeDefinitions)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] }
    : undefined;
}

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

function applyRustCallableValueAdapterRaw(
  expression: RustExpr,
  adapter: RustCallableValueAdapter,
  node: Node,
  context: RustPlanContext,
): { readonly expression: RustExpr; readonly fallible: boolean } | undefined {
  switch (adapter.kind) {
    case "project-structural-view": {
      const projected = planRustProjectStructuralConversion(expression, adapter.sourceCarrier, adapter.targetCarrier, context);
      return projected === undefined ? undefined : { expression: projected, fallible: false };
    }
    case "identity":
      return rustTargetTypeRefEquals(adapter.sourceCarrier, adapter.targetCarrier)
        ? { expression, fallible: false }
        : undefined;
    case "conversion": {
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
