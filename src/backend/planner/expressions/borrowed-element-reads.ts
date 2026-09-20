import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustBorrowedElementRead } from "../../../analysis/program/borrowed-element-reads.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { rustStringTargetType } from "../../../target-model/types/index.js";

export function planRustBorrowedElementRead(
  node: Node,
  read: RustBorrowedElementRead,
  context: RustPlanContext,
  planRead: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const array = planExpression(read.array, context);
  const index = planExpression(read.index, context);
  if (array === undefined || index === undefined) return undefined;
  const arrayName = allocateRustSyntheticName(context.syntheticNames, "array_receiver");
  const indexName = allocateRustSyntheticName(context.syntheticNames, "array_index");
  const elementName = allocateRustSyntheticName(context.syntheticNames, "element");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(read.receiver, {
    expression: { kind: "method-call", receiver: { kind: "path", path: elementName }, method: "expect",
      args: [{ kind: "str-literal", value: "array element is undefined" }] },
    carrier: rustStringTargetType(), valueForm: "shared-reference",
  });
  const body = planRead(node, { ...context, expressionOverrides: overrides });
  if (body === undefined) return undefined;
  return {
    kind: "block",
    bindings: [
      { name: arrayName, value: planRustSharedReceiver(read.array, array, context) },
      { name: indexName, value: index },
    ],
    value: { kind: "method-call", receiver: { kind: "path", path: arrayName }, method: read.method,
      args: [{ kind: "path", path: indexName }, { kind: "closure",
        params: [{ name: elementName, byRefCopy: false }], body }] },
  };
}
