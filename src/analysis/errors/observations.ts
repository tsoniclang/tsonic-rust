import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustProgramErrorCarrier, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { rustCarrierProvidesErrorObservation } from "../../policy/constraints/error-protocols.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function admitRustErrorObservations(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[]): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const validRoute = (source: TargetTypeRef, target: TargetTypeRef, variant: string): boolean => {
    let carrier = source;
    for (let element = rustOptionElementCarrier(carrier); element !== undefined; element = rustOptionElementCarrier(carrier)) carrier = element;
    const definition = program.projectTypes.definitionForCarrier(target);
    const admitted = isRustSourceErrorCarrier(carrier) || isRustRetainedErrorCarrier(carrier) || isRustClosedValueCarrier(carrier);
    return (isRustProgramErrorCarrier(carrier) || admitted) && definition !== undefined &&
      program.projectTypes.programErrorVariant(definition) === variant && rustTargetTypeRefEquals(program.projectTypes.openCarrier(definition), target) &&
      (!admitted || program.projectTypes.sourceErrorDefinitions.includes(definition));
  };
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "program-error-equality") {
      const valid = operation.comparison.kind === "project"
        ? validRoute(operation.sourceCarrier, operation.targetCarrier, operation.comparison.variant)
        : (isRustProgramErrorCarrier(operation.sourceCarrier) || isRustClosedValueCarrier(operation.sourceCarrier) ||
          rustCarrierProvidesErrorObservation(operation.sourceCarrier, program.typeDefinitions)) &&
          rustCarrierProvidesErrorObservation(operation.targetCarrier, program.typeDefinitions);
      if (!valid) refuse(node, "rust.backend.program-error-equality", "Program-error equality conflicts with its exact closed error variant.");
    }
    if (operation?.kind === "program-error-type-test" && !validRoute(operation.sourceCarrier, operation.targetCarrier, operation.variant))
      refuse(node, "rust.backend.program-error-type-test", "Program-error type test conflicts with its exact closed error variant.");
    const flow = program.records.flowReadProjection.get(node);
    if (flow?.kind === "program-error-variant" && !validRoute(flow.sourceCarrier, flow.selectedCarrier, flow.variant))
      refuse(node, "rust.backend.program-error-flow-read", "Program-error flow projection conflicts with its exact closed error variant.");
  }
  return Object.freeze(issues);
}
