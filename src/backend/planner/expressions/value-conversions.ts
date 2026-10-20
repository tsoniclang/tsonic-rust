import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import {
  rustProgramErrorTargetType,
} from "../../../target-model/types/index.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyRustLocalErrorBoundary, rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import {
  registerAliasFromPath,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
} from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { applyRustArgumentMode } from "./input-shaping.js";
import {
  invokeRustStructuralObjectMethod,
  readRustStoredObjectField,
} from "../objects/project-storage.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import type { RustFinalizedValueConversion } from "../../../target-model/records/finalized-operation.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { lowerRustExactIntegerConversion } from "./exact-integer.js";
import { planRustUnionMapping, planRustUnionProjection } from "./union-mappings.js";
import { planRustUnionConstruction } from "./union-patterns.js";
import { planRustAbsentValue, planRustCheckedSourceOptional } from "./optional-storage.js";
import { planRustProjectClosedValue } from "../objects/project-closed-values.js";
import { planRustArrayValueConversion } from "./array-value-conversions.js";
import { planRustSequenceValue } from "./sequence-conversions.js";
import { planRustUnionFold } from "./union-folds.js";
import { planRustProgramErrorConstruction } from "./program-errors.js";
import { planRustProgramErrorClosedValue } from "./program-error-values.js";
import { planRustCallableInputProducer } from "./callable-conversions.js";
import { planRustPropertyValueProjection } from "./property-value-projection.js";
import { planRustOptionBranch } from "./option-branch.js";

export function applyRustValueConversion(
  context: RustPlanContext,
  expression: RustExpr,
  conversion: RustValueConversion | undefined,
  node: Node | undefined,
  sourceIsSharedReference = false,
): RustExpr | undefined {
  if (conversion === undefined) {
    return expression;
  }
  const contract = context.input.program.records.conversionContract.get(conversion)
    ?? failRustPlannerInvariant("An admitted native value conversion requires its sealed physical contract.", node ?? context.sourceFile);
  const producer = conversion.kind === "callable-input"
    ? planRustCallableInputProducer(expression, contract.source, context, node) : expression;
  if (producer === undefined) return undefined;
  const source = contract.sourceMode === "ref" && !sourceIsSharedReference
    ? applyRustArgumentMode(context, producer, "ref", node)
    : producer;
  const converted = lowerRustValueConversion(contract, source, context, node);
  if (converted === undefined) {
    return undefined;
  }
  if (!contract.fallible) {
    return converted;
  }
  const region = context.fallibleBoundary;
  if (region === undefined) failRustPlannerInvariant("An admitted fallible conversion requires its native error region.", node ?? context.sourceFile);
  const providerErrorType = contract.errorBoundary === "provider-native"
    ? rustTypeFromCarrierInContext(contract.errorCarrier, context) : undefined;
  if (contract.errorBoundary === "provider-native" && providerErrorType === undefined) {
    return failRustPlannerInvariant("An admitted fallible conversion requires its rendered native error carrier.", node ?? context.sourceFile);
  }
  return applyRustLocalErrorBoundary(converted, contract.errorBoundary, region, providerErrorType);
}

export function lowerRustValueConversion(
  contract: import("../../../target-model/conversions/contracts.js").RustValueConversionContract,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
): RustExpr | undefined {
  switch (contract.lowering) {
    case "program-error-closed-value":
      return planRustProgramErrorClosedValue(source, contract.target, node, context, rustCurrentErrorBoundary(context));
    case "program-error":
      return planRustProgramErrorConstruction({ kind: "program-error", source: contract.source,
        target: contract.target, route: contract.route }, source, node ?? context.sourceFile, context);
    case "project-closed-value":
      registerAliasFromPath(context, contract.ownerPath);
      return planRustProjectClosedValue(source, contract.ownerPath, contract.source, node, context);
    case "exact-integer":
      return lowerRustExactIntegerConversion(contract, source, context, node ?? context.sourceFile);
    case "rest-sequence":
      return planRustSequenceValue(contract, source, context, node,
        (conversion, value) => lowerNestedRustValueConversion(conversion, value, context, node));
    case "identity":
      return source;
    case "call":
      registerAliasFromPath(context, contract.path);
      return { kind: "call", path: contract.path, args: [source] };
    case "numeric-cast":
      return { kind: "numeric-cast", expression: source, target: contract.targetType };
    case "owned-string-from-borrowed-str":
      return { kind: "owned-string-from-borrowed-str", expression: source };
    case "borrowed-str-from-owned-string":
      return { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [source] };
    case "borrowed-str-from-optional-string":
      return { kind: "method-call", receiver: {
        kind: "method-call", receiver: source, method: "as_deref", args: [],
      }, method: "unwrap_or", args: [{ kind: "str-literal", value: "" }] };
    case "copy-from-reference":
      return { kind: "dereference", pointer: source };
    case "closed-value-from-option": {
      const valueName = allocateConversionName(context, node, "present_value");
      const convert = contract.sourceMode === "ref" ? lowerRustValueConversion : lowerNestedRustValueConversion;
      const converted = convert(
        contract.elementConversion,
        { kind: "path", path: valueName },
        context,
        node,
      );
      return converted === undefined
        ? undefined
        : planRustOptionBranch(source, contract.source, valueName, converted,
          planRustAbsentValue(contract.target, context), context);
    }
    case "js-value-from-array":
      return planRustArrayValueConversion(contract, source, context, node,
        (conversion, value) => lowerNestedRustValueConversion(conversion, value, context, node));
    case "js-array-backing": {
      const element = rustTypeFromCarrierInContext(contract.element, context);
      return element === undefined ? undefined : { kind: "method-call", receiver: source,
        method: contract.method, genericArguments: [{ kind: "type", type: element }], args: [] };
    }
    case "union-fold":
      return planRustUnionFold(source, contract.arms, context, node,
        (arm, payload) => (contract.sourceMode === "ref" ? lowerRustValueConversion : lowerNestedRustValueConversion)
          (arm.conversion, payload, context, node));
    case "js-value-from-structural-to-json":
      return lowerStructuralToJsonValueConversion(
        contract,
        source,
        context,
        node,
      );
    case "js-value-from-properties":
      return planRustPropertyValueProjection(contract, source, context, node,
        (conversion, value) => lowerNestedRustValueConversion(conversion, value, context, node));
    case "js-value-from-structural-object":
      return lowerStructuralObjectJsValueConversion(
        contract,
        source,
        context,
        node,
      );
    case "js-argument-vector-callback": {
      const activeErrorType = contract.lane === "native"
        ? rustActiveErrorType(context)
        : undefined;
      if (contract.lane === "native" && activeErrorType === undefined) {
        return failRustPlannerInvariant("An admitted native RegExp callback projection requires its exact error context.", node ?? context.sourceFile);
      }
      const names = context.syntheticNames ?? createRustSyntheticNameState(
        context.input.program.source.ast,
        node ?? context.sourceFile,
        [],
      );
      const callbackName = allocateRustSyntheticName(names, "replacement_callback");
      const argumentsName = allocateRustSyntheticName(names, "replacement_arguments");
      const argumentsExpression: RustExpr = { kind: "path", path: argumentsName };
      const callbackArguments: RustExpr[] = [];
      for (const [index, projection] of contract.projections.entries()) {
        const path = projection === "native-string"
          ? "js_abi::regexp_replacement_argument_string_native"
          : projection === "exact-string"
            ? "js_abi::regexp_replacement_argument_string"
            : projection === "value"
              ? "js_abi::regexp_replacement_argument_value"
              : "js_abi::regexp_replacement_argument_rest";
        registerAliasFromPath(context, path);
        const projected: RustExpr = {
          kind: "call",
          path,
          args: [
            { kind: "reference", expr: argumentsExpression },
            { kind: "int-literal", text: String(index) },
          ],
        };
        if (projection !== "native-string") {
          callbackArguments.push(projected);
          continue;
        }
        const propagated = context.fallibleBoundary === undefined ? undefined
          : rustPropagateLocalError(context.fallibleBoundary, rustTargetRuntimeErrorType, projected);
        if (propagated === undefined) return undefined;
        callbackArguments.push(propagated);
      }
      const callbackExpression: RustExpr = { kind: "path", path: callbackName };
      const invocation: RustExpr = contract.invocation === "invoke"
        ? { kind: "invoke", callee: callbackExpression, args: callbackArguments }
        : {
            kind: "method-call",
            receiver: callbackExpression,
            method: "call",
            args: [{ kind: "tuple-literal", elements: callbackArguments }],
          };
      const body = contract.sourceFallible || contract.lane === "exact"
        ? invocation
        : {
            kind: "call" as const,
            path: "Ok",
            genericArguments: [
              { kind: "type" as const, type: { kind: "infer" as const } },
              { kind: "type" as const, type: activeErrorType! },
            ],
            args: [invocation],
          };
      return rustValueBlock([{ name: callbackName, value: source }], {
          kind: "closure",
          move: true,
          params: [{ name: argumentsName, byRefCopy: false }],
          body,
        });
    }
    case "union-map":
      return planRustUnionMapping(node ?? context.sourceFile, source, contract.emission, true, context);
    case "union-project":
      return planRustUnionProjection(node ?? context.sourceFile, source, contract.emission, "move", context);
    case "source-union-variant": {
      const payload = contract.payloadConversion === null ? source :
        lowerRustValueConversion(contract.payloadConversion, source, context, node);
      const expression = payload === undefined ? undefined : planRustUnionConstruction(contract.path, payload, context);
      if (expression === undefined) {
        return failRustPlannerInvariant("An admitted source-union conversion requires its exact emitted variant.", node ?? context.sourceFile);
      }
      return expression;
    }
    case "source-optional":
      return planRustCheckedSourceOptional(source, contract.element, context);
    case "option-some": {
      const value = contract.element === null ? source : lowerNestedRustValueConversion(contract.element, source, context, node);
      return value === undefined ? undefined : contract.element?.fallible === true
        ? { kind: "method-call", receiver: value, method: "map", args: [{ kind: "path", path: "Some" }] }
        : { kind: "call", path: "Some", args: [value] };
    }
    case "option-map": {
      if (contract.element.lowering === "copy-from-reference") {
        return {
          kind: "method-call",
          receiver: source,
          method: "copied",
          args: [],
        };
      }
      const valueName = allocateRustSyntheticName(
        context.syntheticNames ?? createRustSyntheticNameState(
          context.input.program.source.ast,
          node ?? context.sourceFile,
          [],
        ),
        "option_value",
      );
      const value: RustExpr = { kind: "path", path: valueName };
      const elementSource: RustExpr = contract.element.sourceMode === "ref"
        ? { kind: "reference", expr: value }
        : value;
      const converted = lowerRustValueConversion(
        contract.element,
        elementSource,
        context,
        node,
      );
      if (converted === undefined) {
        return undefined;
      }
      const directMapper: RustExpr | undefined = contract.element.sourceMode === "value" && contract.element.lowering === "owned-string-from-borrowed-str"
        ? { kind: "path", path: "String::from" }
        : contract.element.sourceMode === "value" && contract.element.lowering === "call"
        ? { kind: "path", path: contract.element.path }
        : undefined;
      const mapped: RustExpr = {
        kind: "method-call",
        receiver: source,
        method: "map",
        args: [directMapper ?? {
          kind: "closure",
          params: [{ name: valueName, byRefCopy: false }],
          body: converted,
        }],
      };
      return contract.element.fallible
        ? { kind: "method-call", receiver: mapped, method: "transpose", args: [] }
        : mapped;
    }
  }
}

function lowerStructuralToJsonValueConversion(
  contract: Extract<
    import("../../../target-model/conversions/contracts.js").RustValueConversionContract,
    { readonly lowering: "js-value-from-structural-to-json" }
  >,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
): RustExpr | undefined {
  const plannedField = context.input.program.records.structuralShape.get(contract.source)?.fields[contract.storageIndex]
    ?? failRustPlannerInvariant("An admitted toJSON projection requires its exact emitted structural method.", node ?? context.sourceFile);
  const sourceName = allocateConversionName(context, node, "json_source");
  const keyName = allocateConversionName(
    context,
    node,
    contract.passesPropertyKey ? "json_property_key" : "_json_property_key",
  );
  const receiver: RustExpr = {
    kind: "method-call",
    receiver: { kind: "path", path: sourceName },
    method: "clone",
    args: [],
  };
  const invocation = invokeRustStructuralObjectMethod(
    contract.source,
    receiver,
    contract.storageIndex,
    contract.passesPropertyKey ? [{ kind: "path", path: keyName }] : [],
    contract.resultCarrier,
    context,
  );
  if (invocation === undefined) {
    return failRustPlannerInvariant("An admitted toJSON projection requires its exact native invocation.", node ?? context.sourceFile);
  }
  const invocationErrorType = plannedField.nativeMethod === true
    ? rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context)
    : rustTargetRuntimeErrorType;
  if (invocationErrorType === undefined) {
    return failRustPlannerInvariant("An admitted toJSON projection requires its rendered native method error.", node ?? context.sourceFile);
  }
  const converted = lowerNestedRustValueConversion(
    contract.resultConversion,
    { kind: "try", expr: invocation, resultErrorType: rustTargetRuntimeErrorType,
      operandErrorType: invocationErrorType },
    context,
    node,
  );
  if (converted === undefined) {
    return undefined;
  }
  registerAliasFromPath(context, "js_abi::js_value_from_json_projection");
  return {
    kind: "call",
    path: "js_abi::js_value_from_json_projection",
    args: [source, {
      kind: "closure",
      move: true,
      params: [
        { name: sourceName, byRefCopy: false },
        { name: keyName, byRefCopy: false },
      ],
      body: {
        kind: "call",
        path: "Ok",
        args: [converted],
      },
    }],
  };
}

export function lowerNestedRustValueConversion(
  contract: import("../../../target-model/conversions/contracts.js").RustValueConversionContract,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
): RustExpr | undefined {
  return lowerRustValueConversion(
    contract,
    contract.sourceMode === "ref"
      ? { kind: "reference", expr: source }
      : source,
    context,
    node,
  );
}

function lowerStructuralObjectJsValueConversion(
  contract: Extract<
    import("../../../target-model/conversions/contracts.js").RustValueConversionContract,
    { readonly lowering: "js-value-from-structural-object" }
  >,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
): RustExpr | undefined {
  const definition = context.input.program.records.structuralShape.get(contract.source)
    ?? failRustPlannerInvariant("An admitted closed value projection requires its native structural shape.", node ?? context.sourceFile);
  const sourceName = allocateConversionName(context, node, "js_object_source");
  const sourcePath = { kind: "path" as const, path: sourceName };
  const entries: RustExpr[] = [];
  for (const field of contract.fields) {
    const plannedField = definition.fields[field.storageIndex];
    if (plannedField === undefined) failRustPlannerInvariant("An admitted closed value field requires its exact native storage.", node ?? context.sourceFile);
    const storedCarrier = plannedField.carrier;
    const stored = readRustStoredObjectField(
      "structural-object",
      contract.source,
      sourcePath,
      field.storageIndex,
      storedCarrier,
      context,
    );
    if (stored === undefined) {
      return undefined;
    }
    if (field.presence === "optional") {
      const valueName = allocateConversionName(
        context,
        node,
        `${field.sourceName}_value`,
      );
      const converted = lowerNestedRustValueConversion(
        field.conversion,
        { kind: "path", path: valueName },
        context,
        node,
      );
      if (converted === undefined) {
        return undefined;
      }
      entries.push({
        kind: "method-call",
        receiver: stored,
        method: "map",
        args: [{
          kind: "closure",
          params: [{ name: valueName, byRefCopy: false }],
          body: {
            kind: "tuple-literal",
            elements: [
              { kind: "str-literal", value: field.sourceName },
              converted,
            ],
          },
        }],
      });
      continue;
    }
    const converted = lowerNestedRustValueConversion(
      field.conversion,
      stored,
      context,
      node,
    );
    if (converted === undefined) {
      return undefined;
    }
    entries.push({
      kind: "call",
      path: "Some",
      args: [{
        kind: "tuple-literal",
        elements: [
          { kind: "str-literal", value: field.sourceName },
          converted,
        ],
      }],
    });
  }
  registerAliasFromPath(context, "js_abi::js_value_from_optional_pairs");
  return rustValueBlock([{ name: sourceName, value: source }], {
      kind: "call",
      path: "js_abi::js_value_from_optional_pairs",
      args: [{ kind: "vec-literal", elements: entries }],
    });
}

function allocateConversionName(
  context: RustPlanContext,
  node: Node | undefined,
  preferred: string,
): string {
  const names = context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast,
    node ?? context.sourceFile,
    [],
  );
  return allocateRustSyntheticName(names, preferred);
}

export function applyFinalizedValueConversion(
  context: RustPlanContext,
  expression: RustExpr,
  conversion: RustFinalizedValueConversion,
  node: Node,
  sourceIsSharedReference = false,
): RustExpr | undefined {
  if (conversion.kind === "sequence") {
    let result: RustExpr | undefined = expression;
    for (let index = 0; index < conversion.steps.length; index += 1) {
      result = applyFinalizedValueConversion(context, result, conversion.steps[index]!, node,
        sourceIsSharedReference && index === 0);
      if (result === undefined) return undefined;
    }
    return result;
  }
  return conversion.kind === "identity"
    ? expression
    : applyRustValueConversion(
        context,
        expression,
        conversion.conversion,
        node,
        sourceIsSharedReference,
      );
}
