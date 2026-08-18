import { appendRustDiagnostic } from "../program/walk.js";
import { rustRegExpSubsetViolation } from "../../policy/regexp/subset.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../policy/types/model.js";

function appendRegExpDiagnostic(walk: RustFactWalk, expression: Node, violation: string): void {
  appendRustDiagnostic(
    walk,
    "RUST_REGEXP_UNSUPPORTED",
    `RegExp construct outside the oracle-proven subset: ${violation}.`,
    expression,
    ["target.capability=rust.js.regexp"],
  );
}

export function resolveRegExpCreation(
  walk: RustFactWalk,
  expression: Node,
  pattern: string,
  flags: string,
): TargetTypeRef | undefined {
  if (!walk.jsEnabled) {
    return undefined;
  }
  const violation = rustRegExpSubsetViolation(pattern, flags);
  if (violation !== undefined) {
    appendRegExpDiagnostic(walk, expression, violation);
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create",
    pattern,
    flags,
  });
  return setCarrierFact(walk, expression, { kind: "target-named", id: "rust.js.JsRegExp" });
}
