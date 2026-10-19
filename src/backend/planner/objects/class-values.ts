import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustItem, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustModuleCell } from "../project/module-storage.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustClassEnvironmentValue, rustClassEnvironmentForCall } from "./class-environments.js";
import { rustClassEnvironmentHandleType } from "./class-environment-types.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRustClassValueRead(node: Node, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.classValueRead.get(node);
  if (selected === undefined) return undefined;
  const declaration = selected.environment.declaration;
  const value = selected.source === "new" ? planRustClassEnvironmentValue(declaration, context) : rustClassEnvironmentForCall(declaration, context);
  if (value === undefined) failRustPlannerInvariant("An admitted class constructor value requires its native environment value.", node);
  const retained: RustExpr = selected.clone ? { kind: "method-call", receiver: value, method: "clone", args: [] } : value;
  if (selected.target === undefined) return retained;
  const type = rustTypeFromCarrierInContext(selected.target, context);
  if (type?.kind !== "named") failRustPlannerInvariant("An admitted class constructor view requires its native named carrier.", node);
  return { kind: "struct-literal", path: type.path, fields: [{ name: "dispatch", value: retained }] };
}

export function planRustClassValues(declaration: Node, context: RustPlanContext): {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
} {
  const selected = context.input.program.records.classValueModule.get(declaration);
  if (selected === undefined) return { items: [], initialization: [] };
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted class module value requires its native name scope.", declaration);
  const type = rustClassEnvironmentHandleType(selected.environment.carrier, context);
  const value = planRustClassEnvironmentValue(declaration, context);
  if (type === undefined || value === undefined) failRustPlannerInvariant("An admitted class module value requires its exact native type and initializer.", declaration);
  const storage = planRustModuleCell(selected.environment.bindingName, type, value, selected.visibility, context.syntheticNames);
  return { items: storage.items, initialization: [storage.initialization] };
}
