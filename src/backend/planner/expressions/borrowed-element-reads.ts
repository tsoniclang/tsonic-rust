import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustBorrowedElementRead } from "../../../target-model/records/storage/borrowed-element-reads.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { rustStringTargetType } from "../../../target-model/types/index.js";
import type { RustBorrowedElementLocal } from "../../../target-model/records/storage/borrowed-element-reads.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustBorrowedElementRead(
  node: Node,
  read: RustBorrowedElementRead,
  context: RustPlanContext,
  planRead: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted borrowed element requires its native name scope.", node);
  const elementName = allocateRustSyntheticName(context.syntheticNames, "element");
  const bindings = borrowedElementBindings(read, elementName, context);
  if (bindings === undefined) failRustPlannerInvariant("An admitted borrowed element requires its selected native inputs.", node);
  const overrides = new Map(context.expressionOverrides ?? []);
  const append = context.input.program.records.borrowedElementAppend.get(node);
  if (append === undefined) failRustPlannerInvariant("An admitted borrowed element requires its selected consumption mode.", node);
  const guard: RustExpr = { kind: "path", path: elementName };
  const element: RustExpr = { kind: "dereference", pointer: guard };
  overrides.set(read.receiver, append
    ? { expression: { kind: "reference", expr: guard }, carrier: rustStringTargetType(), valueForm: "shared-reference" }
    : { expression: element, carrier: rustStringTargetType(), valueForm: "storage", storageForm: "borrow-guard" });
  const body = planRead(node, { ...context, expressionOverrides: overrides });
  return body === undefined ? undefined : rustValueBlock(bindings, body);
}

export function planRustBorrowedElementLocal(
  local: RustBorrowedElementLocal,
  context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly context: RustPlanContext } | undefined {
  const name = context.input.program.records.sourceName.get(local.declaration);
  if (name === undefined) failRustPlannerInvariant("An admitted borrowed local requires its authored native name.", local.declaration);
  const bindings = borrowedElementBindings(local, name, context);
  if (bindings === undefined) failRustPlannerInvariant("An admitted borrowed local requires its native inputs.", local.declaration);
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const reference of local.references) overrides.set(reference, {
    expression: { kind: "dereference", pointer: { kind: "path", path: name } },
    carrier: rustStringTargetType(), valueForm: "storage", storageForm: "borrow-guard",
  });
  return {
    statements: bindings.map(binding => ({ kind: "let", name: binding.name, mutable: false, init: binding.value })),
    context: { ...context, expressionOverrides: overrides },
  };
}

function borrowedElementBindings(
  read: RustBorrowedElementRead,
  name: string,
  context: RustPlanContext,
): readonly { readonly name: string; readonly value: RustExpr }[] | undefined {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted borrowed element requires its native name scope.", read.element);
  const array = planExpression(read.array, context);
  const index = planExpression(read.index, context);
  if (array === undefined || index === undefined) failRustPlannerInvariant("An admitted borrowed element requires its native array and index.", read.element);
  const arrayName = allocateRustSyntheticName(context.syntheticNames, "array_receiver");
  const indexName = allocateRustSyntheticName(context.syntheticNames, "array_index");
  return [
    { name: arrayName, value: planRustSharedReceiver(read.array, array, context) },
    { name: indexName, value: index },
    { name, value: { kind: "method-call", receiver: {
      kind: "method-call", receiver: { kind: "path", path: arrayName }, method: read.method,
      args: [{ kind: "path", path: indexName }],
    }, method: "expect", args: [{ kind: "str-literal", value: "array element is undefined" }] } },
  ];
}
