import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { isValidRustIdentifier, sourceModuleItemPath } from "../program/plan-context.js";
import { rustModuleCellAccess } from "../project/module-storage.js";

type RustSourceStaticFieldFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "source-static-field" }
>;

export function rustSourceStaticFieldCell(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const path = sourceModuleItemPath(context, fact.storageFileName, fact.storageName);
  if (path === undefined || !isValidRustIdentifier(fact.storageName)) {
    return undefined;
  }
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
