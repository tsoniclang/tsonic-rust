import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type {
  RustObjectLiteralMethodParameterAbi,
  RustObjectLiteralValueAdapter,
} from "../../../analysis/facts/keys.js";
import { rustValueConversionContract } from "../../../policy/conversions/contracts.js";
import {
  isRustCopyCarrier,
  isRustVecCarrier,
  rustCarrierSupportsClone,
} from "../../../policy/types/target-types.js";
import type { RustExpr, RustStmt, RustType } from "../../rust-ast/nodes.js";
import {
  lowerRustValueConversion,
  planRustProjectUpcast,
} from "../expressions/index.js";
import type { RustObjectLiteralMethodDispatchPlan } from "./object-literal-implementations.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

export function planRustObjectLiteralMethodArguments(
  method: RustObjectLiteralMethodDispatchPlan,
  context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly adaptedArguments: readonly RustExpr[] } | undefined {
  const adapterPlan = method.adapter;
  if (adapterPlan === undefined || method.parameters.length !== adapterPlan.parameterAbis.length) {
    return undefined;
  }
  const statements: RustStmt[] = [];
  const adaptedArguments: RustExpr[] = [];
  const parameterExpression = (index: number): RustExpr | undefined => {
    const parameter = method.parameters[index];
    return parameter === undefined ? undefined : { kind: "path", path: parameter.name };
  };
  for (const adapter of adapterPlan.parameterAdapters) {
    if (adapter.kind === "omitted") {
      if (adapter.target.form === "optional" || adapter.target.form === "default") {
        adaptedArguments.push({ kind: "none" });
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
          : readObjectLiteralLogicalParameter(expression, source);
        const adapted = logical === undefined
          ? undefined
          : applyRustObjectLiteralValueAdapter(
              logical,
              valueAdapter,
              method.contractMethod,
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
        context.input.ast,
        method.contractMethod,
        [],
      );
      const elementName = allocateRustSyntheticName(names, "rest_element");
      const raw = applyRustObjectLiteralValueAdapterRaw(
        { kind: "path", path: elementName },
        adapter.elementAdapter,
        method.contractMethod,
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
            path: "rt::TsonicResult",
            typeArguments: [targetType],
          }
        : targetType;
      if (raw.fallible) {
        context.usedAliases?.add("rt");
      }
      const collected: RustExpr = {
        kind: "method-call",
        receiver: mapped,
        method: "collect",
        typeArguments: [collectionType],
        args: [],
      };
      adaptedArguments.push(raw.fallible
        ? { kind: "try", expr: collected, errorDomain: "runtime" }
        : collected);
      continue;
    }
    const sourceExpression = parameterExpression(adapter.contractParameterIndex);
    if (sourceExpression === undefined) {
      return undefined;
    }
    if (adapter.kind === "runtime-value") {
      const adapted = applyRustObjectLiteralValueAdapter(
        sourceExpression,
        adapter.adapter,
        method.contractMethod,
        context,
      );
      if (adapted === undefined) {
        return undefined;
      }
      adaptedArguments.push(adapted);
      continue;
    }
    const logical = readObjectLiteralLogicalParameter(sourceExpression, adapter.source);
    const adapted = logical === undefined
      ? undefined
      : applyRustObjectLiteralValueAdapter(
          logical,
          adapter.adapter,
          method.contractMethod,
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
      context.input.ast,
      method.contractMethod,
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

function readObjectLiteralLogicalParameter(
  expression: RustExpr,
  abi: RustObjectLiteralMethodParameterAbi,
): RustExpr | undefined {
  if (abi.mode === "value") {
    return expression;
  }
  const value: RustExpr = { kind: "dereference", pointer: expression };
  if (isRustCopyCarrier(abi.valueCarrier)) {
    return value;
  }
  return rustCarrierSupportsClone(abi.valueCarrier)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] }
    : undefined;
}

export function applyRustObjectLiteralValueAdapter(
  expression: RustExpr,
  adapter: RustObjectLiteralValueAdapter,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const raw = applyRustObjectLiteralValueAdapterRaw(expression, adapter, node, context);
  if (raw === undefined) {
    return undefined;
  }
  if (!raw.fallible) {
    return raw.expression;
  }
  return context.fallibleContext === true
    ? { kind: "try", expr: raw.expression, errorDomain: "runtime" }
    : undefined;
}

function applyRustObjectLiteralValueAdapterRaw(
  expression: RustExpr,
  adapter: RustObjectLiteralValueAdapter,
  node: Node,
  context: RustPlanContext,
): { readonly expression: RustExpr; readonly fallible: boolean } | undefined {
  switch (adapter.kind) {
    case "identity":
      return rustTargetTypeRefEquals(adapter.sourceCarrier, adapter.targetCarrier)
        ? { expression, fallible: false }
        : undefined;
    case "conversion": {
      const contract = rustValueConversionContract(adapter.conversion);
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
      );
      return projected === undefined ? undefined : { expression: projected, fallible: false };
    }
    case "option-some": {
      const element = applyRustObjectLiteralValueAdapterRaw(expression, adapter.element, node, context);
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
        context.input.ast,
        node,
        [],
      );
      const elementName = allocateRustSyntheticName(names, "option_value");
      const element = applyRustObjectLiteralValueAdapterRaw(
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
