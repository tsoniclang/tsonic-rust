import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustStructuralViewIntoRoot } from "./project-structural-roots.js";

export function planRustProjectClosedValue(
  source: RustExpr,
  ownerPath: string,
  carrier: TargetTypeRef,
  node: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.projectClosedValue.get(carrier);
  if (selected === undefined) failRustPlannerInvariant("Native closed-object admission requires its finalized physical object representation.", node ?? context.sourceFile);
  if (selected.kind === "error") {
    return { kind: "call", path: `${ownerPath}::from_error`, args: [source] };
  }
  if (selected.kind === "value") {
    return { kind: "call", path: `${ownerPath}::from_closed`, args: [source] };
  }
  const root = rustStructuralViewIntoRoot(source, selected.representation);
  if (root === undefined) failRustPlannerInvariant("An admitted shared closed-object value requires its native identity-preserving root.", node ?? context.sourceFile);
  return { kind: "call", path: `${ownerPath}::from_shared_identity`, args: [root] };
}
