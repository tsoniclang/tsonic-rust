import type { RustExpr } from "../../rust-ast/nodes.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { isValidRustIdentifier } from "../program/plan-context.js";
import { rustModuleCellAccess } from "../project/module-storage.js";

type RustSourceStaticFieldFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "source-static-field" }
>;

export function rustSourceStaticFieldCell(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const moduleName = context.moduleNameByFileName.get(fact.storageFileName);
  if (moduleName === undefined || !isValidRustIdentifier(fact.storageName)) {
    return undefined;
  }
  const path = moduleName === context.moduleName
    ? fact.storageName
    : `crate::${moduleName}::${fact.storageName}`;
  return { kind: "path", path };
}

export function readRustSourceStaticField(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const cell = rustSourceStaticFieldCell(fact, context);
  if (cell === undefined) {
    return undefined;
  }
  return rustModuleCellAccess(cell, "load", []);
}

export function rustSourceStaticFieldLocation(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const cell = rustSourceStaticFieldCell(fact, context);
  if (cell === undefined) {
    return undefined;
  }
  return rustModuleCellAccess(cell, "location", []);
}
