import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { RustErrorRegionSelection } from "../../target-model/records/error-regions.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";

export function admitRustProjectFieldDispatch(input: {
  readonly ast: AstReader;
  readonly region: RustErrorRegionSelection | undefined;
  readonly dispatch: RustProjectFieldDispatchQueries;
}, node: Node, operation: RustTargetOperationFact): TargetDiagnostic | undefined {
  if (operation.kind !== "source-field" && operation.kind !== "source-union-field") return undefined;
  const declarations = operation.kind === "source-field"
    ? operation.dispatch === undefined || operation.declaration === undefined ? [] : [operation.declaration]
    : operation.variants.flatMap(variant => variant.field?.dispatch === undefined || variant.field.declaration === undefined ? [] : [variant.field.declaration]);
  const fallible = declarations.some(declaration => {
    const plan = input.dispatch.planFor(declaration);
    return plan !== undefined && (operation.accessMode !== "write" && plan.read.fallible ||
      operation.accessMode !== "read" && plan.write?.fallible === true);
  });
  if (!fallible || input.region !== undefined && input.region.kind !== "infallible" && input.region.localOwner !== undefined) return undefined;
  return Object.freeze({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
    message: `A fallible project field dispatch requires an exact enclosing error ABI. Node kind: ${input.ast.kindName(node)}.`,
    evidence: Object.freeze(["target.capability=rust.error.project-field-dispatch"]) });
}
