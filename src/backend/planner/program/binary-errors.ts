import type { RustExpr, RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import { planRustNativeErrorJoin, type RustNativeErrorJoinSelection,
  type RustNativeErrorJoinSource } from "../types/native-error-joins.js";

export interface RustBinaryErrorPlan {
  readonly errorType: RustType;
  readonly items: readonly RustItem[];
  lifecycle(result: RustExpr, operandErrorType: RustType): RustExpr;
  lifecycleError(error: RustExpr, operandErrorType: RustType): RustExpr;
  propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr;
}

export function planRustBinaryErrors(
  lifecycleType: RustType,
  nativeSources: readonly RustNativeErrorJoinSource[] = [],
  includeLifecycle = true,
): RustBinaryErrorPlan {
  const lifecycle = { identity: "lifecycle", variant: "Lifecycle", errorType: lifecycleType };
  const join = planRustNativeErrorJoin({ identity: "binary-startup-errors", name: "StartupErrors",
    visibility: "private", sources: [...(includeLifecycle ? [lifecycle] : []), ...nativeSources] });
  if (join?.errorType === undefined) throw new Error("Binary startup requires a complete native error composition.");
  const propagate = (source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr => {
    const selected = join.propagate(source, result);
    if (selected === undefined) throw new Error("Binary startup propagation requires an exact selected native error channel.");
    return selected;
  };
  return Object.freeze({ errorType: join.errorType, items: join.items, propagate,
    lifecycle(result: RustExpr, operandErrorType: RustType): RustExpr {
      const converted: RustExpr = rustTypeEquals(operandErrorType, lifecycleType) ? result : {
        kind: "method-call", receiver: result, method: "map_err",
        args: [{ kind: "associated-value", owner: lifecycleType, name: "from" }],
      };
      return propagate(lifecycle, converted);
    },
    lifecycleError(error: RustExpr, operandErrorType: RustType): RustExpr {
      const converted: RustExpr = rustTypeEquals(operandErrorType, lifecycleType) ? error
        : { kind: "associated-call", owner: lifecycleType, method: "from", args: [error] };
      const selected = join.inject(lifecycle, converted);
      if (selected === undefined) throw new Error("Binary lifecycle errors require the exact selected native channel.");
      return selected;
    },
  });
}
