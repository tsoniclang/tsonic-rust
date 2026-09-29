import type { RustExpr } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";

export function planRustOptionBranch(
  option: RustExpr,
  carrier: TargetTypeRef,
  presentName: string,
  present: RustExpr,
  absent: RustExpr,
  context: RustPlanContext,
): RustExpr {
  if (rustOptionalStorageValue(carrier) === undefined) {
    return { kind: "match", expression: option, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: presentName }] }, expression: present },
      { pattern: { kind: "path", path: "None" }, expression: absent },
    ] };
  }
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile, []);
  const storedName = allocateRustSyntheticName(names, "optional_storage");
  const stored: RustExpr = { kind: "path", path: storedName };
  return { kind: "block", bindings: [{ name: storedName, value: option }], value: {
    kind: "conditional",
    condition: planRustOptionalStorageOperation(carrier, "is_absent", [{ kind: "reference", expr: stored }], context),
    whenTrue: absent,
    whenFalse: { kind: "block", bindings: [{ name: presentName,
      value: planRustOptionalStorageOperation(carrier, "into_present", [stored], context) }], value: present },
  } };
}
