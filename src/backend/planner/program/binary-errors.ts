import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustExpr, RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { planRustNativeErrorJoin, type RustNativeErrorJoinSelection } from "../types/native-error-joins.js";
import type { RustBinaryErrorSelection } from "../../../target-model/records/errors/error-regions.js";

export interface RustBinaryErrorPlan {
  readonly errorType: RustType;
  readonly items: readonly RustItem[];
  lifecycle(result: RustExpr, operandErrorType?: RustType): RustExpr;
  lifecycleError(error: RustExpr, operandErrorType?: RustType): RustExpr;
  propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr;
}

export function planRustBinaryErrors(
  selection: RustBinaryErrorSelection,
  lifecycleType: RustType,
  nativeSources: readonly RustNativeErrorJoinSelection[] = [],
): RustBinaryErrorPlan {
  const lifecycle = { identity: "lifecycle", errorType: lifecycleType };
  const nativeByIdentity = new Map(nativeSources.map(source => [source.identity, source.errorType]));
  if (selection.sources.length === 0) {
    if (selection.lifecycle?.region.kind !== "infallible" || nativeSources.length !== 0)
      failRustPlannerInvariant("Binary startup requires a complete native error composition.");
    const propagate = (source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr => {
      if (source.identity !== lifecycle.identity || !rustTypeEquals(source.errorType, lifecycleType))
        failRustPlannerInvariant("Binary startup propagation requires an exact selected native error channel.");
      return { kind: "try", expr: result, operandErrorType: lifecycleType, resultErrorType: lifecycleType };
    };
    return Object.freeze({ errorType: lifecycleType, items: Object.freeze([]), propagate,
      lifecycle(result: RustExpr, operandErrorType?: RustType): RustExpr {
        if (operandErrorType === undefined || !rustTypeEquals(operandErrorType, lifecycleType))
          failRustPlannerInvariant("Binary startup propagation requires an exact selected native error channel.");
        return propagate(lifecycle, result);
      },
      lifecycleError(error: RustExpr, operandErrorType?: RustType): RustExpr {
        if (operandErrorType === undefined || !rustTypeEquals(operandErrorType, lifecycleType))
          failRustPlannerInvariant("Binary lifecycle errors require the exact selected native channel.");
        return error;
      },
    });
  }
  const sources = selection.sources.map(source => {
    const errorType = source.kind === "lifecycle" ? lifecycleType : nativeByIdentity.get(source.identity);
    if (errorType === undefined)
      failRustPlannerInvariant("Binary startup requires a complete native error composition.");
    return { identity: source.identity, variant: source.variant, errorType };
  });
  const join = planRustNativeErrorJoin({ identity: "binary-startup-errors", name: "StartupErrors",
    visibility: "private", resultShape: "result", sources });
  if (join?.errorType === undefined) {
    failRustPlannerInvariant("Binary startup requires a complete native error composition.");
  }
  const propagate = (source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr => {
    const selected = join.propagate(source, result);
    if (selected === undefined) {
      failRustPlannerInvariant("Binary startup propagation requires an exact selected native error channel.");
    }
    return selected;
  };
  return Object.freeze({ errorType: join.errorType, items: join.items, propagate,
    // A caller that knows the operand's error type passes it; an identical type propagates without conversion.
    lifecycle(result: RustExpr, operandErrorType?: RustType): RustExpr {
      const converted: RustExpr = operandErrorType !== undefined && rustTypeEquals(operandErrorType, lifecycleType) ? result : {
        kind: "method-call", receiver: result, method: "map_err",
        args: [{ kind: "associated-value", owner: lifecycleType, name: "from" }],
      };
      return propagate(lifecycle, converted);
    },
    lifecycleError(error: RustExpr, operandErrorType?: RustType): RustExpr {
      const converted: RustExpr = operandErrorType !== undefined && rustTypeEquals(operandErrorType, lifecycleType) ? error
        : { kind: "associated-call", owner: lifecycleType, method: "from", args: [error] };
      const selected = join.inject(lifecycle, converted);
      if (selected === undefined) {
        failRustPlannerInvariant("Binary lifecycle errors require the exact selected native channel.");
      }
      return selected;
    },
  });
}
