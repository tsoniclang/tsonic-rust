import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustItem, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { sourceModuleItemPath } from "../program/plan-context.js";
import { planRustModuleCell, rustModuleCellAccess } from "../project/module-storage.js";
import { createRustStructuralObjectFromCarrier, type RustStructuralObjectFieldInitializer } from "./project-storage.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustClassValueFactKey } from "../../../analysis/facts/class-values.js";
import { rustOptionElementCarrier, rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "../../../target-model/types/index.js";

export function planRustClassValueRead(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = context.input.program.facts.getFact(node, rustClassValueFactKey);
  const view = fact === undefined ? undefined : context.input.program.classValues.viewFor(fact.declaration, fact.carrier);
  if (fact === undefined || view === undefined) return undefined;
  const ast = context.input.program.source.ast;
  const path = sourceModuleItemPath(context, ast.getFileName(ast.getSourceFile(fact.declaration)), view.storageName);
  return path === undefined ? undefined : rustModuleCellAccess({ kind: "path", path }, "load", []);
}

export function planRustClassValues(declaration: Node, context: RustPlanContext): {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
} | undefined {
  const definition = context.input.program.classValues.forDeclaration(declaration);
  if (definition === undefined) return { items: [], initialization: [] };
  if (context.syntheticNames === undefined) return undefined;
  context.usedAliases?.add("rt");
  const identity = planRustModuleCell(definition.identityName, { kind: "named", path: "rt::ObjectIdentity" },
    { kind: "call", path: "rt::ObjectIdentity::new", args: [] }, "crate", context.syntheticNames);
  const items: RustItem[] = [...identity.items];
  const initialization: RustStmt[] = [identity.initialization];
  for (const view of definition.views) {
    const type = rustTypeFromCarrierInContext(view.carrier, context);
    if (type === undefined) return undefined;
    const initializers: RustStructuralObjectFieldInitializer[] = [];
    for (const field of view.fields) {
      const path = sourceModuleItemPath(context, field.fileName, field.targetName);
      const storage = context.input.program.structuralShapes.field(view.carrier, field.storageIndex);
      if (path === undefined || storage === undefined || initializers.length !== field.storageIndex) return undefined;
      const getterType = rustTypeFromCarrierInContext(rustOptionElementCarrier(
        rustStructuralPropertyGetterStorageCarrier(view.carrier, storage.carrier, storage.presence)), context);
      const setterType = field.writable ? rustTypeFromCarrierInContext(rustOptionElementCarrier(
        rustStructuralPropertySetterStorageCarrier(view.carrier, storage.carrier, storage.presence)), context) : undefined;
      if (getterType === undefined || field.writable && setterType === undefined) return undefined;
      const cell: RustExpr = { kind: "path", path };
      const getter: RustExpr = { kind: "associated-call", owner: getterType, method: "new", args: [{
        kind: "closure", params: [{ name: "_receiver", byRefCopy: false }],
        body: { kind: "call", path: "Ok", args: [rustModuleCellAccess(cell, "load", [])] },
      }] };
      const setter: RustExpr | undefined = setterType !== undefined ? {
        kind: "associated-call", owner: setterType, method: "new", args: [{
          kind: "closure", params: [{ name: "arguments", byRefCopy: false }],
          body: { kind: "evaluate-then", effect: {
            kind: "method-call", receiver: rustModuleCellAccess(cell, "location", []),
            method: "store", args: [{ kind: "field", receiver: { kind: "path", path: "arguments" }, name: "1" }],
          }, discard: "unit", value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } },
        }],
      } : undefined;
      initializers.push({ kind: "accessor", getter, ...(setter === undefined ? {} : { setter }) });
    }
    const value = createRustStructuralObjectFromCarrier(view.carrier, initializers, context,
      rustModuleCellAccess({ kind: "path", path: definition.identityName }, "load", []));
    if (value === undefined) return undefined;
    const planned = planRustModuleCell(view.storageName, type, value, "crate", context.syntheticNames);
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
