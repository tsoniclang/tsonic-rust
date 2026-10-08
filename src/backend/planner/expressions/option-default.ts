import type { RustExpr } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { planRustOptionBranch } from "./option-branch.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";

export function rustOptionDefaultValue(
  option: RustExpr,
  fallback: RustExpr,
  carrier: TargetTypeRef,
  context: RustPlanContext,
  resultCarrier?: TargetTypeRef,
): RustExpr {
  const value = rustOptionalStorageValue(carrier);
  const retainStorage = rustTargetTypeRefEquals(resultCarrier, carrier) && !rustTargetTypeRefEquals(value, carrier);
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile, []);
  const presentName = allocateRustSyntheticName(names, "present_value");
  const expression: RustExpr = { kind: "path", path: presentName };
  const present = !retainStorage ? expression : value === undefined
    ? { kind: "call" as const, path: "Some", args: [expression] }
    : planRustOptionalStorageOperation(carrier, "present", [expression], context);
  return planRustOptionBranch(option, carrier, presentName, present, fallback, context);
}
