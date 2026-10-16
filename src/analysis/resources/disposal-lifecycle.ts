import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";

export interface RustDisposalLifecycleInput {
  readonly source: TargetSourceProgram;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
}

export function validateRustDisposalLifecycle(input: RustDisposalLifecycleInput, declaration: Node,
  frame: { readonly asynchronous: boolean; readonly fallible: boolean }): TargetDiagnostic | undefined {
  const { ast } = input.source;
  const kind = ast.variableDeclarationKind(declaration);
  if (kind !== "using" && kind !== "await using") return undefined;
  const reject = (code: string, message: string): TargetDiagnostic => ({
    code, category: "error", source: "tsonic-rust", sourceNode: declaration, message,
    evidence: ["target.capability=rust.resource-management.selected-lifecycle"],
  });
  const selected = input.records.resourceManagement.get(declaration);
  if (selected === undefined || selected.declarationKind !== kind) {
    return reject("RUST_RESOURCE_MANAGEMENT_NOT_PROVEN", "Resource declaration requires its exact selected native disposal contract.");
  }
  const name = ast.name(declaration);
  const selectedName = input.names.nameForDeclaration(declaration);
  if (name === undefined || !ast.is.IsIdentifier(name) || selectedName === undefined || !isValidRustIdentifier(selectedName)) {
    return reject("RUST_RESOURCE_BINDING_NOT_PROVEN", "Resource management requires one exact native binding name.");
  }
  if ((kind === "await using" || selected.disposal.kind === "async") && !frame.asynchronous) {
    return reject("RUST_RESOURCE_ASYNC_FRAME_NOT_PROVEN", "Asynchronous resource management requires its finalized asynchronous execution owner.");
  }
  if (selected.disposal.fallible && !frame.fallible) {
    return reject("RUST_RESOURCE_ERROR_FRAME_NOT_PROVEN", "Fallible disposal requires its finalized native error owner.");
  }
  return undefined;
}
