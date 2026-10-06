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
  for (const declaration of context.input.program.captureStorage.deferredForScope(scope)) {
    if (context.bindingLocations?.has(declaration)) continue;
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
    statements.push({ kind: "let", name, mutable: fact.iterationScope !== undefined, type,
      init: { kind: "call", path: "rt::Location::uninitialized", args: [] } });
  }
  return statements;
}

export function planRustCaptureStorageRotation(scope: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const declaration of context.input.program.captureStorage.iterationsForScope(scope)) {
    const fact = context.input.program.facts.getFact(declaration, rustBindingStorageFactKey);
    const name = context.input.program.names.nameForDeclaration(declaration);
    if (name === undefined || fact?.storage !== "location" || fact.iterationScope !== scope) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
        "rust.backend.iteration-capture-storage", "Iteration capture storage requires its exact native location and activation scope."));
      return undefined;
    }
    context.usedAliases?.add("rt");
    statements.push({ kind: "assign", operator: "=", target: { kind: "path", path: name },
      value: { kind: "call", path: "rt::Location::allocate", args: [{
        kind: "method-call", receiver: { kind: "path", path: name }, method: "load", args: [],
      }] } });
  }
  return statements;
}
