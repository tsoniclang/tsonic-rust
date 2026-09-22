import type { RustGeneratorFact } from "../../../analysis/facts/keys.js";
import { isRustUnitCarrier } from "../../../target-model/types/index.js";
import type { RustBlock, RustExpr, RustType } from "../../target-ast/nodes.js";
import { applyRustTailShape } from "../statements/block-flow.js";
import { applyFallibleShape } from "../types/fallible-shape.js";

export function planRustGeneratorBody(
  body: RustBlock,
  fact: RustGeneratorFact,
  controllerName: string,
  errorType: RustType,
): RustExpr {
  const staticStorage = fact.storage.kind === "static";
  const path = fact.kind === "sync"
    ? staticStorage ? "rt::Generator::new" : "rt::BorrowedGenerator::new"
    : staticStorage ? "rt::AsyncGenerator::new" : "rt::BorrowedAsyncGenerator::new";
  const hasReturnValue = !isRustUnitCarrier(fact.returnType);
  return {
    kind: "call",
    path,
    args: [{
      kind: "closure-block",
      params: [{ name: controllerName, mutable: false }],
      move: true,
      async: true,
      body: applyFallibleShape(applyRustTailShape(body, hasReturnValue), {
        fallible: true,
        hasReturnValue,
        errorType,
        inferErrorTypeFromReturnType: false,
      }),
    }],
  };
}
