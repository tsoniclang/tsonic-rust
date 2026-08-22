import type { Node } from "@tsonic/tsts";
import {
  ClassStaticBlock_Body,
  KindClassStaticBlockDeclaration,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  rustCarrierSupportsClone,
} from "../../../target-model/types/index.js";
import { rustProjectStaticFieldStorage } from "../../../analysis/project-types/object-layout.js";
import type { RustItem, RustStmt } from "../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import { planBlockLike } from "../statements/index.js";
import { planRustModuleCell } from "../project/module-storage.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export interface PlannedRustClassInitialization {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
}

export function planRustClassInitialization(
  declaration: Node,
  context: RustPlanContext,
): PlannedRustClassInitialization | undefined {
  const { ast } = context.input.program.source;
  const items: RustItem[] = [];
  const initialization: RustStmt[] = [];
  for (const member of ast.members(declaration)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.static-field-member",
        "Class declaration contains an undefined static-field member slot.",
      ));
      return undefined;
    }
    if (ast.kindName(member) === KindClassStaticBlockDeclaration) {
      const body = ClassStaticBlock_Body(ast, member);
      const planned = body === undefined ? undefined : planBlockLike(body, context);
      if (planned === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class-static-block",
          "Class static block has no exact plannable body.",
        ));
        return undefined;
      }
      initialization.push({ kind: "scope", body: planned });
      continue;
    }
    const storage = rustProjectStaticFieldStorage(
      member,
      ast,
      context.input.program.projectTypes.memberSlotName(member, "static"),
    );
    if (storage === undefined) {
      continue;
    }
    const initializer = Node_Initializer(ast, member);
    if (initializer === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.static-field-initializer",
        "Rust static class fields require an initializer so their runtime value is exact.",
      ));
      return undefined;
    }
    const carrier = context.input.program.facts.getRuntimeCarrierFact(member)?.carrier;
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (carrier === undefined || type === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.static-field-carrier",
        "Static class field has no finalized renderable Rust carrier.",
      ));
      return undefined;
    }
    if (!rustCarrierSupportsClone(carrier)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.static-field-carrier",
        "Rust static class fields require one exact Clone-capable value carrier.",
      ));
      return undefined;
    }
    const value = planExpression(initializer, context);
    if (value === undefined || context.syntheticNames === undefined) {
      return undefined;
    }
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(
      storage.targetName,
      type,
      value,
      "crate",
      context.syntheticNames,
      [],
    );
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
