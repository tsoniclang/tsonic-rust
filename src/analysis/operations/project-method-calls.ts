import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";

export function recordSelectedMethodSpecialization(
  walk: RustFactWalk,
  expression: Node,
  declaration: Node,
  targetTypeArguments: readonly TargetTypeRef[],
): boolean {
  const { ast } = walk.context;
  if (ast.typeParameters(declaration).length === 0) return true;
  const registration = walk.context.sourceCallableSpecializations.recordProjectMethodCall({
    subject: expression,
    ...(walk.currentCallableDeclaration === undefined ? {} : { caller: walk.currentCallableDeclaration }),
    declaration,
    targetTypeArguments,
    ast,
    projectTypes: walk.context.projectTypes,
    sourceLifetimes: walk.context.sourceLifetimes,
  });
  if (registration.kind === "accepted") return true;
  appendRustDiagnostic(walk, "RUST_PROJECT_METHOD_SPECIALIZATION_UNAVAILABLE", registration.reason,
    expression, ["target.capability=rust.project-dispatch.finite-generic-specialization"]);
  return false;
}
