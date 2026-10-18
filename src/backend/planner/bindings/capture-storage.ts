import type { Node } from "@tsonic/tsts";
import type { RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic, failRustPlannerInvariant } from "../diagnostics.js";

import { requireRustNativeBindingStorage, rustNativeBindingSlotType, createRustNativeBindingPayload }
  from "../expressions/binding-storage.js";

export function planRustDeferredCaptureStorage(scope: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const declaration of context.input.program.captureStorage.deferredForScope(scope)) {
    if (context.bindingLocations?.has(declaration)) continue;
    const fact = context.input.program.records.bindingStorage.get(declaration);
    const name = context.input.program.names.nameForDeclaration(declaration);
    const storage = requireRustNativeBindingStorage(declaration, context);
    const type = rustNativeBindingSlotType(storage, context);
    if (name === undefined || type === undefined || fact?.storage !== "location" || fact.initialization !== "deferred") {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
        "rust.backend.deferred-capture-storage", "Deferred capture storage requires its exact native location and declaration identity."));
      return undefined;
    }
    context.usedAliases?.add("rt");
    if (storage.deferredConstructor === null) return failRustPlannerInvariant(
      "A deferred native capture requires its completed deferred constructor.", declaration);
    statements.push({ kind: "let", name, mutable: fact.iterationScope !== undefined, type,
      init: { kind: "call", path: storage.deferredConstructor, args: [] } });
  }
  return statements;
}

export function planRustCaptureStorageRotation(scope: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const declaration of context.input.program.captureStorage.iterationsForScope(scope)) {
    const fact = context.input.program.records.bindingStorage.get(declaration);
    const name = context.input.program.names.nameForDeclaration(declaration);
    if (name === undefined || fact?.storage !== "location" || fact.iterationScope !== scope) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
        "rust.backend.iteration-capture-storage", "Iteration capture storage requires its exact native location and activation scope."));
      return undefined;
    }
    const storage = requireRustNativeBindingStorage(declaration, context);
    const value = createRustNativeBindingPayload(storage, {
      kind: "method-call", receiver: { kind: "path", path: name }, method: "load", args: [],
    }, context);
    if (value === undefined) return undefined;
    statements.push({ kind: "assign", operator: "=", target: { kind: "path", path: name },
      value });
  }
  return statements;
}
