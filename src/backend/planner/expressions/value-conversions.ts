import {
  rustCallableProtocol,
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
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
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
