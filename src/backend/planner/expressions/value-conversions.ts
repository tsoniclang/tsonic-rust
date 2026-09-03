import {
  rustOptionTargetType,
  rustCallableProtocol,
  rustStructuralObjectCarrierValue,
  rustSourceUnionCarrierValue,
} from "../../../target-model/types/index.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import {
  diagnosticInput,
  registerAliasFromPath,
  rustActiveErrorType,
  sourceTypePath,
} from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustEffectiveValueCarrier } from "../../../analysis/facts/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { applyRustArgumentMode } from "./input-shaping.js";
import {
  invokeRustStructuralObjectMethod,
  readRustStoredObjectField,
} from "../objects/project-storage.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueConversion } from "../../../analysis/facts/keys.js";
import type { RustFinalizedValueConversion } from "../../../analysis/facts/finalized-operation-abi.js";

export function applyRustValueConversion(
  context: RustPlanContext,
  expression: RustExpr,
  conversion: RustValueConversion | undefined,
  node: Node | undefined,
  validateSourceCarrier = true,
): RustExpr | undefined {
  if (conversion === undefined) {
    return expression;
  }
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.value-conversion-contract",
      "Target value conversion has no closed Rust semantic conversion contract.",
    ));
    return undefined;
  }
  if (validateSourceCarrier) {
    const sourceCarrier = node === undefined
      ? undefined
      : rustEffectiveValueCarrier(context.input.program.facts, node);
    if (sourceCarrier === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node ?? context.sourceFile),
        "rust.backend.value-conversion-source",
        "Target value conversion has no finalized source carrier evidence.",
      ));
      return undefined;
    }
    if (!rustTargetTypeRefEquals(sourceCarrier, contract.source)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node ?? context.sourceFile),
        "rust.backend.value-conversion-source",
        "Target value conversion source does not match the finalized source carrier.",
      ));
      return undefined;
    }
  }
  const nonConsumingSource = contract.sourceMode === "ref" && node !== undefined
    ? planRustNonConsumingValue(node, expression, context)
    : expression;
  const source = contract.sourceMode === "ref"
    ? applyRustArgumentMode(context, nonConsumingSource, "ref", node)
    : nonConsumingSource;
  const converted = lowerRustValueConversion(contract, source, context, node);
  if (converted === undefined) {
    return undefined;
  }
  if (!contract.fallible) {
    return converted;
  }
  const activeErrorType = rustActiveErrorType(context);
  if (activeErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.value-conversion",
      "Fallible target value conversion requires a finalized fallible lowering context.",
    ));
    return undefined;
  }
  return {
    kind: "try",
    expr: converted,
    resultErrorType: activeErrorType,
    operandErrorType: rustTargetRuntimeErrorType,
  };
}

export function lowerRustValueConversion(
  contract: import("../../../target-model/conversions/contracts.js").RustValueConversionContract,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
): RustExpr | undefined {
  switch (contract.lowering) {
    case "identity":
      return source;
    case "call":
      registerAliasFromPath(context, contract.path);
      return { kind: "call", path: contract.path, args: [source] };
    case "numeric-cast":
      return { kind: "numeric-cast", expression: source, target: contract.targetType };
    case "owned-string-from-borrowed-str":
      return { kind: "owned-string-from-borrowed-str", expression: source };
    case "copy-from-reference":
      return { kind: "dereference", pointer: source };
    case "js-value-from-option": {
      registerAliasFromPath(context, "js_abi::JsValue");
      const valueName = allocateConversionName(context, node, "js_value");
      const converted = lowerNestedRustValueConversion(
        contract.elementConversion,
        { kind: "path", path: valueName },
        context,
        node,
      );
      return converted === undefined
        ? undefined
        : {
            kind: "method-call",
            receiver: {
              kind: "method-call",
              receiver: source,
              method: "map",
              args: [{
                kind: "closure",
                params: [{ name: valueName, byRefCopy: false }],
                body: converted,
              }],
            },
            method: "unwrap_or",
            args: [{ kind: "path", path: "js_abi::JsValue::Undefined" }],
          };
    }
    case "js-value-from-array": {
      registerAliasFromPath(context, "js_abi::js_value_from_array");
      const valueName = allocateConversionName(context, node, "array_value");
      const converted = lowerNestedRustValueConversion(
        contract.elementConversion,
        { kind: "path", path: valueName },
        context,
        node,
      );
      return converted === undefined
        ? undefined
        : {
            kind: "call",
            path: "js_abi::js_value_from_array",
            args: [source, {
              kind: "closure",
              params: [{ name: valueName, byRefCopy: false }],
              body: converted,
          }],
        };
    }
    case "js-value-from-source-union": {
      const union = rustSourceUnionCarrierValue(contract.source);
      const typePath = union === undefined ? undefined : sourceTypePath(context, union);
      if (union === undefined || typePath === undefined ||
        union.variants.length !== contract.variants.length) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node ?? context.sourceFile),
          "rust.backend.js-value-source-union",
          "Closed JavaScript-value projection has no exact emitted source-union contract.",
        ));
        return undefined;
      }
      const names = context.syntheticNames ?? createRustSyntheticNameState(
        context.input.program.source.ast,
        node ?? context.sourceFile,
        [],
      );
      const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
      for (const [index, variant] of contract.variants.entries()) {
        const sourceVariant = union.variants[index];
        if (sourceVariant === undefined || sourceVariant.name !== variant.name ||
          !rustTargetTypeRefEquals(sourceVariant.carrier, variant.carrier)) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node ?? context.sourceFile),
            "rust.backend.js-value-source-union",
            "Closed JavaScript-value projection conflicts with its finalized source-union variant order.",
          ));
          return undefined;
        }
        const valueName = allocateRustSyntheticName(
          names,
          `json_${variant.name}_value`,
        );
        const converted = lowerNestedRustValueConversion(
          variant.conversion,
          { kind: "path", path: valueName },
          context,
          node,
        );
        if (converted === undefined) {
          return undefined;
        }
        arms.push({
          pattern: {
            kind: "tuple-variant",
            path: `${typePath}::${variant.name}`,
            elements: [{ kind: "binding", name: valueName }],
          },
          expression: converted,
        });
      }
      return { kind: "match", expression: source, arms };
    }
    case "js-value-from-structural-to-json":
      return lowerStructuralToJsonValueConversion(
        contract,
        source,
        context,
        node,
      );
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
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node ?? context.sourceFile),
          "rust.backend.regexp-callback-native-string",
          "A native RegExp callback projection requires a finalized fallible lowering context.",
        ));
        return undefined;
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
        callbackArguments.push({
          kind: "try",
          expr: projected,
          resultErrorType: activeErrorType!,
          operandErrorType: rustTargetRuntimeErrorType,
        });
      }
      const callbackExpression: RustExpr = { kind: "path", path: callbackName };
      const invocation: RustExpr = rustCallableProtocol(contract.source) === undefined
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
      return {
        kind: "block",
        bindings: [{ name: callbackName, value: source }],
        value: {
          kind: "closure",
          move: true,
          params: [{ name: argumentsName, byRefCopy: false }],
          body,
        },
      };
    }
    case "source-union-variant": {
      const union = rustSourceUnionCarrierValue(contract.target);
      const typePath = union === undefined ? undefined : sourceTypePath(context, union);
      if (union === undefined || typePath === undefined ||
        union.variants.filter((variant) =>
          variant.name === contract.variantName &&
          rustTargetTypeRefEquals(variant.carrier, contract.source)).length !== 1) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node ?? context.sourceFile),
          "rust.backend.source-union-conversion",
          "Source-union conversion has no exact emitted variant contract.",
        ));
        return undefined;
      }
      return {
        kind: "call",
        path: `${typePath}::${contract.variantName}`,
        args: [source],
      };
    }
    case "option-some":
      return { kind: "call", path: "Some", args: [source] };
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
      const directMapper: RustExpr | undefined = converted.kind === "call" &&
          converted.args.length === 1 && converted.args[0]?.kind === "path" &&
          converted.args[0].path === valueName
        ? { kind: "path", path: converted.path }
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
  const structural = rustStructuralObjectCarrierValue(contract.source);
  const field = structural?.fields[contract.storageIndex];
  const plannedField = context.input.program.structuralShapes.field(
    contract.source,
    contract.storageIndex,
  );
  if (field === undefined || field.method !== true || field.sourceName !== "toJSON" ||
    field.presence !== "required" || plannedField === undefined ||
    plannedField.method !== true || plannedField.sourceName !== "toJSON") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.js-value-to-json",
      "Selected toJSON projection has no exact emitted structural method contract.",
    ));
    return undefined;
  }
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.js-value-to-json-invocation",
      "Selected toJSON projection cannot be invoked through its exact structural method storage.",
    ));
    return undefined;
  }
  const converted = lowerNestedRustValueConversion(
    contract.resultConversion,
    invocation,
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

function lowerNestedRustValueConversion(
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
  const structural = rustStructuralObjectCarrierValue(contract.source);
  const definition = context.input.program.structuralShapes.definitionForCarrier(
    contract.source,
  );
  if (structural === undefined || definition === undefined ||
    structural.fields.length !== definition.fields.length ||
    structural.fields.filter((field) => field.method !== true).length !==
      contract.fields.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.js-value-structural-shape",
      "Closed JavaScript-value projection conflicts with the finalized structural object shape.",
    ));
    return undefined;
  }
  const sourceName = allocateConversionName(context, node, "js_object_source");
  const sourcePath = { kind: "path" as const, path: sourceName };
  const entries: RustExpr[] = [];
  for (const field of contract.fields) {
    const structuralField = structural.fields[field.storageIndex];
    const plannedField = definition.fields[field.storageIndex];
    if (structuralField === undefined || plannedField === undefined ||
      structuralField.sourceName !== field.sourceName ||
      plannedField.sourceName !== field.sourceName ||
      plannedField.storage !== "stored" || plannedField.method === true ||
      structuralField.accessor !== undefined || structuralField.method === true) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node ?? context.sourceFile),
        "rust.backend.js-value-structural-field",
        `Closed JavaScript-value projection field '${field.sourceName}' has no exact stored-field plan.`,
      ));
      return undefined;
    }
    const storedCarrier = structuralField.type;
    const stored = readRustStoredObjectField(
      "object-handle",
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
      const expectedStorage = rustOptionTargetType(field.sourceCarrier);
      if (!rustTargetTypeRefEquals(storedCarrier, expectedStorage)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node ?? context.sourceFile),
          "rust.backend.js-value-optional-field",
          `Optional JavaScript-value projection field '${field.sourceName}' has no exact optional storage carrier.`,
        ));
        return undefined;
      }
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
  return {
    kind: "block",
    bindings: [{ name: sourceName, value: source }],
    value: {
      kind: "call",
      path: "js_abi::js_value_from_optional_pairs",
      args: [{ kind: "vec-literal", elements: entries }],
    },
  };
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
  position: "source-input" | "operation-result",
): RustExpr | undefined {
  return conversion.kind === "identity"
    ? expression
    : applyRustValueConversion(
        context,
        expression,
        conversion.conversion,
        node,
        position === "source-input",
      );
}
