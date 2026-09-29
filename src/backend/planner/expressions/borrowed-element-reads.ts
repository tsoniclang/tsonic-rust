import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustBorrowedElementRead } from "../../../analysis/program/borrowed-element-reads.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { rustStringTargetType } from "../../../target-model/types/index.js";
import type { RustBorrowedElementLocal } from "../../../analysis/program/borrowed-element-locals.js";

export function planRustBorrowedElementRead(
  node: Node,
  read: RustBorrowedElementRead,
  context: RustPlanContext,
  planRead: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const elementName = allocateRustSyntheticName(context.syntheticNames, "element");
  const bindings = borrowedElementBindings(read, elementName, context);
  if (bindings === undefined) return undefined;
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(read.receiver, {
    expression: { kind: "dereference", pointer: { kind: "path", path: elementName } },
    carrier: rustStringTargetType(), valueForm: "storage",
  });
  const body = planRead(node, { ...context, expressionOverrides: overrides });
  return body === undefined ? undefined : { kind: "block", bindings, value: body };
}

export function planRustBorrowedElementLocal(
  local: RustBorrowedElementLocal,
  context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly context: RustPlanContext } | undefined {
  const name = context.input.program.names.nameForDeclaration(local.declaration);
  if (name === undefined) return undefined;
  const bindings = borrowedElementBindings(local, name, context);
  if (bindings === undefined) return undefined;
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const reference of local.references) overrides.set(reference, {
    expression: { kind: "dereference", pointer: { kind: "path", path: name } },
    carrier: rustStringTargetType(), valueForm: "storage",
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
  if (context.syntheticNames === undefined) return undefined;
  const array = planExpression(read.array, context);
  const index = planExpression(read.index, context);
  if (array === undefined || index === undefined) return undefined;
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
