import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { rustJsRegExpTargetType } from "../../target-model/types/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function resolveRegExpCreation(
  walk: RustFactWalk,
  expression: Node,
  pattern: string,
  flags: string,
): TargetTypeRef | undefined {
  if (!walk.jsEnabled) {
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create",
    pattern,
    flags,
  });
  return setCarrierFact(walk, expression, rustJsRegExpTargetType());
}
