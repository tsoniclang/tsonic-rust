import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustOptionBranch } from "./option-branch.js";
import { planRustPresentValue } from "./optional-storage.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function rustOptionDefaultValue(option: RustExpr, fallback: RustExpr, carrier: TargetTypeRef,
  context: RustPlanContext, retainStorage: boolean): RustExpr {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted optional default requires its native name scope.", context.callableDeclaration ?? context.sourceFile);
  const name = allocateRustSyntheticName(context.syntheticNames, "present_value");
  const value: RustExpr = { kind: "path", path: name };
  return planRustOptionBranch(option, carrier, name, retainStorage ? planRustPresentValue(carrier, value, context) : value, fallback, context);
}
