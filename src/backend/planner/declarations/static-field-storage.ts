import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { isValidRustIdentifier, sourceModuleItemPath } from "../program/plan-context.js";
import { rustModuleCellAccess } from "../project/module-storage.js";
import { rustClassEnvironmentForCall } from "../objects/class-environments.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

type RustSourceStaticFieldFact = Pick<Extract<
  RustTargetOperationFact,
  { readonly kind: "source-static-field" }
>, "declaration" | "storageFileName" | "storageName" | "resultCarrier">;

function rustSourceStaticFieldCell(
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
  const local = classStaticField(fact, context);
  if (local !== undefined) {
    const value: RustExpr = local.readonly ? local.field
      : { kind: "method-call", receiver: local.field, method: "borrow", args: [] };
    return isRustCopyCarrier(fact.resultCarrier)
      ? local.readonly ? value : { kind: "dereference", pointer: value }
      : { kind: "method-call", receiver: value, method: "clone", args: [] };
  }
  const cell = rustSourceStaticFieldCell(fact, context);
  if (cell === undefined) {
    return undefined;
  }
  return rustModuleCellAccess(cell, "load", []);
}

export function planRustSourceStaticFieldStorage(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly read: RustExpr;
  readonly write: (value: RustExpr) => RustExpr;
} | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "static_field");
  const reference: RustExpr = { kind: "path", path: name };
  const local = classStaticField(fact, context);
  if (local !== undefined) {
    if (local.readonly) return undefined;
    const borrowed: RustExpr = { kind: "method-call", receiver: reference, method: "borrow", args: [] };
    return {
      bindings: [{ name, value: { kind: "reference", expr: local.field } }],
      read: isRustCopyCarrier(fact.resultCarrier) ? { kind: "dereference", pointer: borrowed }
        : { kind: "method-call", receiver: borrowed, method: "clone", args: [] },
      write: value => ({ kind: "assignment", operator: "=", value, target: {
        kind: "dereference", pointer: { kind: "method-call", receiver: reference, method: "borrow_mut", args: [] },
      } }),
    };
  }
  const cell = rustSourceStaticFieldCell(fact, context);
  if (cell === undefined) {
    return undefined;
  }
  return {
    bindings: [{ name, value: rustModuleCellAccess(cell, "location", []) }],
    read: { kind: "method-call", receiver: reference, method: "load", args: [] },
    write: value => ({ kind: "method-call", receiver: reference, method: "store", args: [value] }),
  };
}

function classStaticField(fact: RustSourceStaticFieldFact, context: RustPlanContext): {
  readonly field: RustExpr;
  readonly readonly: boolean;
} | undefined {
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(fact.declaration);
  const environment = owner === undefined ? undefined : context.input.program.classValues.forDeclaration(owner.declaration)?.environment;
  if (environment === undefined || context.input.program.source.ast.parent(environment.declaration) ===
    context.input.program.source.ast.getSourceFile(environment.declaration)) return undefined;
  const field = environment.staticFields.find(field => field.declaration === fact.declaration);
  const receiver = rustClassEnvironmentForCall(environment.declaration, context);
  if (field === undefined || receiver === undefined) throw new Error("A local static field lost its sealed environment storage.");
  return { field: { kind: "field", receiver, name: field.fieldName }, readonly: field.readonly };
}
