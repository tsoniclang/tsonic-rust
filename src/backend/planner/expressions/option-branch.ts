import { rustValueBlock } from "../../target-ast/value-block.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { rustLiteralIsNativeDefault, rustLiteralMayEvaluateEagerly } from "../../target-ast/inspection/literal-defaults.js";

export function planRustOptionBranch(
  option: RustExpr,
  carrier: TargetTypeRef,
  presentName: string,
  present: RustExpr,
  absent: RustExpr,
  context: RustPlanContext,
): RustExpr {
  if (rustOptionalStorageValue(carrier) === undefined) {
    if (present.kind === "path" && present.path === presentName) {
      if (rustLiteralIsNativeDefault(absent)) {
        return { kind: "method-call", receiver: option, method: "unwrap_or_default", args: [] };
      }
      if (rustLiteralMayEvaluateEagerly(absent)) {
        return { kind: "method-call", receiver: option, method: "unwrap_or", args: [absent] };
      }
    }
    return { kind: "match", expression: option, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: presentName }] }, expression: present },
      { pattern: { kind: "path", path: "None" }, expression: absent },
    ] };
  }
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile, []);
  const storedName = allocateRustSyntheticName(names, "optional_storage");
  const stored: RustExpr = { kind: "path", path: storedName };
  const extracted = planRustOptionalStorageOperation(carrier, "into_present", [stored], context);
  const presentResult: RustExpr = present.kind === "path" && present.path === presentName
    ? extracted : rustValueBlock([{ name: presentName, value: extracted }], present);
  return rustValueBlock([{ name: storedName, value: option }], {
    kind: "conditional",
    condition: planRustOptionalStorageOperation(carrier, "is_absent", [{ kind: "reference", expr: stored }], context),
    whenTrue: absent,
    whenFalse: presentResult,
  });
}
