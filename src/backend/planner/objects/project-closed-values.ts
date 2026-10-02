import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustStructuralViewIntoRoot } from "./project-structural-roots.js";

export function planRustProjectClosedValue(
  source: RustExpr,
  ownerPath: string,
  carrier: TargetTypeRef,
  node: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const definition = context.input.program.projectTypes.definitionForCarrier(carrier);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (representation === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.native-closed-object", "Native closed-object admission requires its finalized physical object representation."));
    return undefined;
  }
  if (representation.kind === "value") {
    return { kind: "call", path: `${ownerPath}::from_closed`, args: [source] };
  }
  const root = rustStructuralViewIntoRoot(source, representation);
  return root === undefined ? undefined
    : { kind: "call", path: `${ownerPath}::from_shared_identity`, args: [root] };
}
