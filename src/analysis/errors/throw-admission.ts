import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustErrorRegionSelection } from "../../target-model/records/errors/error-regions.js";
import type { RustThrowCompletion } from "../../target-model/records/operations/exception-flow.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustProgramErrorCarrier } from "../../target-model/types/carriers/js.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function admitRustThrowCompletion(input: {
  readonly ast: AstReader; readonly records: RustProgramRecords; readonly region: RustErrorRegionSelection | undefined;
  readonly componentId: string | undefined;
}, node: Node): { readonly kind: "resolved"; readonly completion: RustThrowCompletion }
  | { readonly kind: "rejected"; readonly diagnostic: TargetDiagnostic } {
  const operation = input.records.targetOperation.get(node);
  const expression = Node_Expression(input.ast, node);
  if (operation?.kind !== "throw-op" || expression === undefined || operation.error.expression !== expression)
    failTargetAnalysisInvariant("tsonic-rust", "Throw admission requires its exact selected source operation.", node);
  const carrier = operation.error.kind === "conversion" ? operation.error.conversion.source : operation.error.carrier;
  if (!rustTargetTypeRefEquals(rustEffectiveValueCarrier(input.records, expression), carrier) ||
    operation.error.kind === "program" && !isRustProgramErrorCarrier(carrier))
    failTargetAnalysisInvariant("tsonic-rust", "Throw admission requires its exact selected native operand carrier.", expression);
  const refuse = (subject: Node, capability: string, message: string) => ({ kind: "rejected" as const,
    diagnostic: Object.freeze({ code: "RUST_UNSUPPORTED_AST", category: "error" as const, source: "tsonic-rust",
      sourceNode: subject, message: `${message} Node kind: ${input.ast.kindName(subject)}.`,
      evidence: Object.freeze([`target.capability=${capability}`]) }) });
  if (input.region === undefined || input.region.kind === "infallible") return refuse(node, "rust.error.throw",
    "throw requires a fallible lowering context.");
  const owner = input.region.localOwner;
  if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "A local throw requires its source-package error channel before publication.", node);
  if (operation.error.kind === "program" && owner.domain === "project" && owner.componentId !== input.componentId)
    return refuse(expression, "rust.error.cross-package-rethrow",
      "A source-package program error cannot be rethrown through an unrelated callable error ABI.");
  return { kind: "resolved", completion: Object.freeze({ operation, owner }) };
}
