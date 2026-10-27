import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { isValidRustIdentifier } from "../../../../target-model/names/identifiers.js";
import { sourceModuleItemPath } from "../../program/plan-context.js";
import { rustModuleCellAccess } from "../../project/module-storage.js";
import { rustClassEnvironmentForCall } from "../../objects/class-environments.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planExpression } from "../../expressions/entry.js";

type RustSourceStaticFieldFact = Pick<Extract<
  RustTargetOperationFact,
  { readonly kind: "source-static-field" }
>, "declaration" | "classReceiver" | "storageFileName" | "storageName" | "resultCarrier">;

function rustSourceStaticFieldCell(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const path = sourceModuleItemPath(context, fact.storageFileName, fact.storageName);
  if (path === undefined || !isValidRustIdentifier(fact.storageName)) {
    failRustPlannerInvariant("An admitted static field requires its native storage identifier and module path.", fact.declaration);
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
    const read: RustExpr = local.copy
      ? local.readonly ? value : { kind: "dereference", pointer: value }
      : { kind: "method-call", receiver: value, method: "clone", args: [] };
    if (local.bindings.length === 0) return read;
    if (context.syntheticNames === undefined) failRustPlannerInvariant("A static-field read has no native local-name allocator.", fact.declaration);
    const name = allocateRustSyntheticName(context.syntheticNames, "static_value");
    return rustValueBlock([...local.bindings, { name, value: read }], { kind: "path", path: name });
  }
  const cell = rustSourceStaticFieldCell(fact, context);
  if (cell === undefined) {
      failRustPlannerInvariant("An admitted static field requires its native module cell.", fact.declaration);
  }
  const read = rustModuleCellAccess(cell, "load", []);
  if (fact.classReceiver === undefined) return read;
  const receiver = planExpression(fact.classReceiver, context);
  if (receiver === undefined) failRustPlannerInvariant("An admitted static field requires its native class receiver.", fact.declaration);
  return { kind: "evaluate-then", effect: receiver, discard: "value", value: read };
}

export function planRustSourceStaticFieldStorage(
  fact: RustSourceStaticFieldFact,
  context: RustPlanContext,
): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly read: RustExpr;
  readonly write: (value: RustExpr) => RustExpr;
} | undefined {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted static field write requires its native local-name allocator.", fact.declaration);
  const name = allocateRustSyntheticName(context.syntheticNames, "static_field");
  const reference: RustExpr = { kind: "path", path: name };
  const local = classStaticField(fact, context);
  if (local !== undefined) {
    if (local.readonly) failRustPlannerInvariant("An admitted static field write requires its writable environment slot.", fact.declaration);
    const borrowed: RustExpr = { kind: "method-call", receiver: reference, method: "borrow", args: [] };
    return {
      bindings: [...local.bindings, { name, value: { kind: "reference", expr: local.field } }],
      read: local.copy ? { kind: "dereference", pointer: borrowed }
        : { kind: "method-call", receiver: borrowed, method: "clone", args: [] },
      write: value => ({ kind: "evaluate-then", discard: "unit", effect: {
        kind: "assignment", operator: "=", value, target: {
          kind: "dereference", pointer: { kind: "method-call", receiver: reference, method: "borrow_mut", args: [] },
        },
      }, value: { kind: "tuple-literal", elements: [] } }),
    };
  }
  const cell = rustSourceStaticFieldCell(fact, context);
  if (cell === undefined) {
    failRustPlannerInvariant("An admitted static field write requires its native module cell.", fact.declaration);
  }
  const receiver = fact.classReceiver === undefined ? undefined : planExpression(fact.classReceiver, context);
  if (fact.classReceiver !== undefined && receiver === undefined) failRustPlannerInvariant("An admitted static field write requires its native class receiver.", fact.declaration);
  return {
    bindings: [...(receiver === undefined ? [] : [{ name: allocateRustSyntheticName(context.syntheticNames, "_class_receiver"), value: receiver }]),
      { name, value: rustModuleCellAccess(cell, "location", []) }],
    read: { kind: "method-call", receiver: reference, method: "load", args: [] },
    write: value => ({ kind: "method-call", receiver: reference, method: "store", args: [value] }),
  };
}

function classStaticField(fact: RustSourceStaticFieldFact, context: RustPlanContext): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly field: RustExpr;
  readonly readonly: boolean;
  readonly copy: boolean;
} | undefined {
  const selected = context.input.program.records.staticFieldStorage.get(fact.declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted static field requires its sealed native storage selection.", fact.declaration);
  const environment = selected.environment;
  if (environment === undefined) return undefined;
  let receiver = fact.classReceiver === undefined ? rustClassEnvironmentForCall(environment.declaration, context)
    : planExpression(fact.classReceiver, context);
  if (receiver === undefined) failRustPlannerInvariant("An admitted local static field requires its native environment receiver.", fact.declaration);
  const bindings: { name: string; value: RustExpr }[] = [];
  if (fact.classReceiver !== undefined) {
    if (context.syntheticNames === undefined) failRustPlannerInvariant("A selected class receiver has no native local-name allocator.", fact.declaration);
    const name = allocateRustSyntheticName(context.syntheticNames, "class_receiver");
    bindings.push({ name, value: receiver });
    receiver = { kind: "path", path: name };
  }
  return { bindings, field: { kind: "field", receiver, name: environment.name }, readonly: environment.readonly, copy: selected.copy };
}
