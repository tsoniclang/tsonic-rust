import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { AstRegularExpressionLiteralSyntax, Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function resolveRegExpCreation(
  walk: RustFactWalk,
  expression: Node,
  syntax: AstRegularExpressionLiteralSyntax,
): TargetTypeRef | undefined {
  if (!walk.jsEnabled) {
    return undefined;
  }
  const resultCarrier: TargetTypeRef = {
    kind: "target-named",
    id: "rust.js.JsRegExp",
  };
  setRustOperationFact(walk, expression, {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create.literal",
    targetOperation: "js_abi::JsRegExp::new",
    input: {
      kind: "literal",
      pattern: syntax.pattern,
      flags: syntax.flags,
    },
    resultCarrier,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}
