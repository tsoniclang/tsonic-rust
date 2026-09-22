import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustItem, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustSourceItemIsPubliclyReachable } from "../program/plan-context.js";
import { planRustModuleCell } from "../project/module-storage.js";
import { rustClassValueFactKey } from "../../../analysis/facts/class-values.js";
import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustClassEnvironmentValue, rustClassEnvironmentForCall } from "./class-environments.js";
import { rustClassEnvironmentHandleType } from "./class-environment-types.js";

export function planRustClassValueRead(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = context.input.program.facts.getFact(node, rustClassValueFactKey);
  if (fact === undefined) return undefined;
  const environment = context.input.program.classValues.forDeclaration(fact.declaration)?.environment;
  if (environment === undefined) return undefined;
  const ast = context.input.program.source.ast;
  const value = ast.is.IsClassExpression(node) ? planRustClassEnvironmentValue(fact.declaration, context)
    : rustClassEnvironmentForCall(fact.declaration, context);
  if (value === undefined) return undefined;
  const retained: RustExpr = ast.is.IsClassExpression(node) || environment.copy ||
    ast.parent(fact.declaration) === ast.getSourceFile(fact.declaration)
    ? value : { kind: "method-call", receiver: value, method: "clone", args: [] };
  if (rustClassConstructorInstance(fact.carrier) !== undefined) return retained;
  const view = context.input.program.classValues.viewFor(fact.declaration, fact.sourceCarrier, fact.carrier);
  const type = view === undefined ? undefined : rustTypeFromCarrierInContext(view.targetCarrier, context);
  return type?.kind !== "named" ? undefined : {
    kind: "struct-literal", path: type.path, fields: [{ name: "dispatch", value: retained }],
  };
}

export function planRustClassValues(declaration: Node, context: RustPlanContext): {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
} | undefined {
  const definition = context.input.program.classValues.forDeclaration(declaration);
  if (definition?.environment?.evaluatedConstructorValue !== true) return { items: [], initialization: [] };
  if (context.syntheticNames === undefined) return undefined;
  const type = rustClassEnvironmentHandleType(definition.environment.carrier, context);
  const value = planRustClassEnvironmentValue(declaration, context);
  if (type === undefined || value === undefined) return undefined;
  const storage = planRustModuleCell(definition.environment.bindingName, type, value,
    rustSourceItemIsPubliclyReachable(context, definition.environment.bindingName) ? "public" : "crate", context.syntheticNames);
  return { items: storage.items, initialization: [storage.initialization] };
}
