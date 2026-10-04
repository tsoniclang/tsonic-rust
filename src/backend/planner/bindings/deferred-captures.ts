import type { Node } from "@tsonic/tsts";
import type { RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustBindingStorageFactKey } from "../../../analysis/facts/keys.js";
import { rustLocationTargetType } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";

export function planRustDeferredCaptureStorage(scope: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const declaration of context.input.program.deferredCaptures.forScope(scope)) {
    const fact = context.input.program.facts.getFact(declaration, rustBindingStorageFactKey);
    const name = context.input.program.names.nameForDeclaration(declaration);
    const type = fact === undefined ? undefined : rustTypeFromCarrierInContext(rustLocationTargetType(fact.valueCarrier), context);
    if (name === undefined || type === undefined || fact?.storage !== "location" || fact.initialization !== "deferred") {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
        "rust.backend.deferred-capture-storage", "Deferred capture storage requires its exact native location and declaration identity."));
      return undefined;
    }
    if (!requireRustLocationValueCarrier(fact.valueCarrier, declaration, context)) return undefined;
    context.usedAliases?.add("rt");
    statements.push({ kind: "let", name, mutable: false, type,
      init: { kind: "call", path: "rt::Location::uninitialized", args: [] } });
  }
  return statements;
}
