import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "../../common/source-ast.js";
import {
  rustCarrierSupportsClone,
} from "../../source/rust-target-types.js";
import { rustProjectStaticFieldStorage } from "../../source/rust-target-semantics/project-object-layout.js";
import type { RustItem, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planRustModuleCell } from "./module-storage.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";

export interface PlannedRustClassStaticFields {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
}

export function planRustClassStaticFields(
  declaration: Node,
  context: RustPlanContext,
): PlannedRustClassStaticFields | undefined {
  const { ast } = context.input;
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
    const storage = rustProjectStaticFieldStorage(member, ast);
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
    const carrier = context.input.facts.getRuntimeCarrierFact(member)?.carrier;
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
      ["#[allow(non_upper_case_globals)]"],
    );
    items.push(planned.item);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
