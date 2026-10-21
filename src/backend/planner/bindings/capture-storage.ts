import type { Node } from "@tsonic/tsts";
import type { RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

import { rustLocationTargetType } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";

export function planRustDeferredCaptureStorage(scope: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const declaration of context.input.program.records.captureStorageScope.get(scope)?.deferred ?? []) {
    if (context.bindingLocations?.has(declaration)) continue;
    const fact = context.input.program.records.bindingStorage.get(declaration);
    const name = context.input.program.records.sourceName.get(declaration);
    const type = fact === undefined ? undefined : rustTypeFromCarrierInContext(rustLocationTargetType(fact.valueCarrier), context);
    if (name === undefined || type === undefined || fact?.storage !== "location" || fact.initialization !== "deferred") {
      failRustPlannerInvariant("Deferred capture storage requires its exact native location and declaration identity.", declaration);
    }
    if (!requireRustLocationValueCarrier(fact.valueCarrier, declaration, context)) failRustPlannerInvariant("Admitted capture storage requires its native location carrier.", declaration);
    context.usedAliases?.add("rt");
    statements.push({ kind: "let", name, mutable: fact.iterationScope !== undefined, type,
      init: { kind: "call", path: "rt::Location::uninitialized", args: [] } });
  }
  return statements;
}

export function planRustCaptureStorageRotation(scope: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const declaration of context.input.program.records.captureStorageScope.get(scope)?.iterations ?? []) {
    const fact = context.input.program.records.bindingStorage.get(declaration);
    const name = context.input.program.records.sourceName.get(declaration);
    if (name === undefined || fact?.storage !== "location" || fact.iterationScope !== scope) {
      failRustPlannerInvariant("Iteration capture storage requires its exact native location and activation scope.", declaration);
    }
    context.usedAliases?.add("rt");
    statements.push({ kind: "assign", operator: "=", target: { kind: "path", path: name },
      value: { kind: "call", path: "rt::Location::allocate", args: [{
        kind: "method-call", receiver: { kind: "path", path: name }, method: "load", args: [],
      }] } });
  }
  return statements;
}
