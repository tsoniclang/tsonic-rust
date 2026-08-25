import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function rustSealedReadKind(
  node: Node,
  context: RustPlanContext,
): "copy" | "move" | "clone" | "borrowed" | undefined {
  return context.input.program.ownership.readDispositionFor(node)?.kind;
}

export function planRustSealedOwnedRead(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
  capability: string,
): RustExpr | undefined {
  const disposition = context.input.program.ownership.readDispositionFor(node);
  if (disposition?.kind === "copy" || disposition?.kind === "move") return expression;
  if (disposition?.kind === "clone") {
    return { kind: "method-call", receiver: expression, method: "clone", args: [] };
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    capability,
    disposition === undefined
      ? "An owned Rust value read has no sealed ownership disposition."
      : "A borrowed Rust value cannot be projected as an owned value without an explicit operation.",
  ));
  return undefined;
}
