import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustOptionBranch(option: RustExpr, carrier: TargetTypeRef, presentName: string,
  present: RustExpr, absent: RustExpr, context: RustPlanContext): RustExpr {
  const storage = context.input.program.records.typeEmission.get(carrier)?.optionalStorage;
  if (storage?.kind === "option") return { kind: "match", expression: option, arms: [
    { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: presentName }] }, expression: present },
    { pattern: { kind: "path", path: "None" }, expression: absent },
  ] };
  if (storage?.kind !== "custom" || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted optional branch requires its native storage and name scope.", context.callableDeclaration ?? context.sourceFile);
  const storedName = allocateRustSyntheticName(context.syntheticNames, "optional_storage");
  const stored: RustExpr = { kind: "path", path: storedName };
  return rustValueBlock([{ name: storedName, value: option }], {
    kind: "conditional",
    condition: planRustOptionalStorageOperation(carrier, "is_absent", [{ kind: "reference", expr: stored }], context),
    whenTrue: absent,
    whenFalse: rustValueBlock([{ name: presentName, value: planRustOptionalStorageOperation(carrier, "into_present", [stored], context) }], present),
  });
}
