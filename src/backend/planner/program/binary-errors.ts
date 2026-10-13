import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";

export interface RustBinaryErrorPlan {
  readonly errorType: RustType;
  lifecycle(result: RustExpr, operandErrorType: RustType): RustExpr;
  lifecycleError(error: RustExpr, operandErrorType: RustType): RustExpr;
}

export function planRustBinaryErrors(errorType: RustType): RustBinaryErrorPlan {
  return Object.freeze({ errorType,
    lifecycle(result: RustExpr, operandErrorType: RustType): RustExpr {
      const converted: RustExpr = rustTypeEquals(operandErrorType, errorType) ? result : {
        kind: "method-call", receiver: result, method: "map_err",
        args: [{ kind: "associated-value", owner: errorType, name: "from" }],
      };
      return { kind: "try", expr: converted, operandErrorType: errorType, resultErrorType: errorType };
    },
    lifecycleError(error: RustExpr, operandErrorType: RustType): RustExpr {
      return rustTypeEquals(operandErrorType, errorType) ? error
        : { kind: "associated-call", owner: errorType, method: "from", args: [error] };
    },
  });
}
