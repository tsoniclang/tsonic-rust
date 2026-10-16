import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import type { RustErrorRegionSelection, RustJsRejectionConversion } from "../../../target-model/records/error-regions.js";
import { rustJsValueTargetType } from "../../../target-model/types/carriers/js.js";
import { rustJsRejectionErrorIdentity } from "../../../target-model/records/error-effects.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import { planRustProgramErrorClosedValue } from "../expressions/program-error-values.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustJsRejectionErrorType } from "../types/error-boundary.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustNativeErrorJoinPlan, RustNativeErrorJoinSelection } from "../types/native-error-joins.js";
import { rustErrorType, rustNativeFallibleBoundary, type RustFallibleBoundary } from "./fallible-boundaries.js";
import { registerAliasFromPath, type RustPlanContext } from "./plan-context.js";
import { resolveRustPhysicalProgramErrorBoundary } from "./source-package-errors.js";

export function planRustJsRejectionRegion(
  declaration: Node,
  selected: RustErrorRegionSelection,
  context: RustPlanContext,
): { readonly boundary: RustFallibleBoundary | undefined } | undefined {
  const rejection = selected.jsRejection;
  if (rejection === undefined) return undefined;
  if (rejection.local === undefined && rejection.sources.length === 0) return Object.freeze({ boundary: undefined });
  registerAliasFromPath(context, "js_abi::JsValue");
  const owner = selected.localOwner === undefined ? undefined : resolveRustPhysicalProgramErrorBoundary(
    context.sourcePackageErrors, context.sourcePackageComponentId, selected.localOwner);
  if (selected.localOwner !== undefined && owner === undefined) return undefined;
  const local = owner === undefined ? undefined : Object.freeze({ owner,
    source: Object.freeze({ identity: `package:${owner.errorTypeIdentity}`, errorType: rustErrorType(owner) }) });
  const conversions = new Map<string, { readonly errorType: RustType; readonly conversion: RustJsRejectionConversion }>();
  if (local !== undefined && rejection.local !== undefined)
    conversions.set(local.source.identity, { errorType: local.source.errorType, conversion: rejection.local });
  for (const source of rejection.sources) {
    const errorType = rustTypeFromCarrierInContext(source.conversion.carrier, context);
    if (errorType === undefined) return undefined;
    conversions.set(source.identity, { errorType, conversion: source.conversion });
  }
  const binding = (base: string): string => {
    if (context.syntheticNames === undefined)
      failTargetPlannerInvariant("tsonic-rust", "JS rejection reconstruction requires sealed hygienic name state.", declaration);
    return allocateRustSyntheticName(context.syntheticNames, base);
  };
  const convert = (conversion: RustJsRejectionConversion, error: RustExpr): RustExpr | undefined => {
    switch (conversion.kind) {
      case "identity": return error;
      case "uninhabited": return { kind: "match", expression: error, arms: [] };
      case "retained-error": return { kind: "call", path: "js_abi::JsValue::from_error", args: [error] };
      case "program-error": {
        const boundary = resolveRustPhysicalProgramErrorBoundary(context.sourcePackageErrors,
          context.sourcePackageComponentId, conversion.owner);
        return boundary === undefined ? undefined
          : planRustProgramErrorClosedValue(error, rustJsValueTargetType(), declaration, context, boundary);
      }
      case "native-join": {
        const carrier = rustTypeFromCarrierInContext(conversion.carrier, context);
        if (carrier?.kind !== "named") return undefined;
        const name = binding("rejection_payload");
        const payload: RustExpr = { kind: "path", path: name };
        const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
        for (const [index, arm] of conversion.arms.entries()) {
          const expression = convert(arm, payload);
          if (expression === undefined) return undefined;
          arms.push({ pattern: { kind: "tuple-variant", path: `${carrier.path}::Error${index}`,
            elements: [{ kind: "binding", name }] }, expression });
        }
        return { kind: "match", expression: error, arms };
      }
    }
  };
  const lookup = (source: RustNativeErrorJoinSelection) => {
    const selected = conversions.get(source.identity);
    return selected !== undefined && rustTypeEquals(selected.errorType, source.errorType) ? selected : undefined;
  };
  const join: RustNativeErrorJoinPlan = Object.freeze({ errorType: rustJsRejectionErrorType, items: Object.freeze([]),
    accepts: (source: RustNativeErrorJoinSelection) => lookup(source) !== undefined,
    inject(source: RustNativeErrorJoinSelection, error: RustExpr): RustExpr | undefined {
      const selected = lookup(source);
      return selected === undefined ? undefined : convert(selected.conversion, error);
    },
    propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined {
      const selected = lookup(source);
      if (selected === undefined) return undefined;
      const name = selected.conversion.kind === "identity" ? undefined : binding("rejection_error");
      const error: RustExpr | undefined = name === undefined ? undefined
        : convert(selected.conversion, { kind: "path", path: name });
      if (name !== undefined && error === undefined) return undefined;
      const mapped: RustExpr = name === undefined ? result : { kind: "method-call", receiver: result, method: "map_err",
        genericArguments: [{ kind: "type", type: rustJsRejectionErrorType }, { kind: "type", type: { kind: "infer" } }],
        args: [{ kind: "closure", params: [{ name }], body: error! }] };
      return { kind: "try", expr: mapped, operandErrorType: rustJsRejectionErrorType, resultErrorType: rustJsRejectionErrorType };
    },
    mapError(error: RustExpr, _bindingName: string,
      select: Parameters<RustNativeErrorJoinPlan["mapError"]>[2]): RustExpr | undefined {
      return select({ identity: rustJsRejectionErrorIdentity, errorType: rustJsRejectionErrorType }, error);
    },
  });
  const boundary = rustNativeFallibleBoundary(join, local);
  return boundary === undefined ? undefined : Object.freeze({ boundary });
}
