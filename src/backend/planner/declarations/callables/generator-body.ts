import type { RustGeneratorFact } from "../../../../target-model/records/callables/callables-and-resources.js";
import { isRustUnitCarrier } from "../../../../target-model/types/index.js";
import type { RustBlock, RustExpr } from "../../../target-ast/syntax/nodes.js";
import { applyRustTailShape } from "../../../target-ast/normalization/block-flow.js";

export function planRustGeneratorBody(
  body: RustBlock,
  fact: RustGeneratorFact,
  controllerName: string,
): RustExpr {
  const staticStorage = fact.storage.kind === "static";
  const path = fact.kind === "sync"
    ? staticStorage ? "rt::Generator::new" : "rt::BorrowedGenerator::new"
    : staticStorage ? "rt::AsyncGenerator::new" : "rt::BorrowedAsyncGenerator::new";
  return {
    kind: "call",
    path,
    args: [{
      kind: "closure-block",
      params: [{ name: controllerName, mutable: false }],
      move: true,
      async: true,
      body: applyRustTailShape(body, !isRustUnitCarrier(fact.returnType), new Set([controllerName])),
    }],
  };
}
