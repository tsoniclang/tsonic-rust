import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustBindingEmissionProducer } from "../program/records/binding-emission.js";
import { isRustCopyCarrier, rustCarrierSupportsClone, rustFixedArrayCarrierValue, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { selectRustBindingProjectionEmission } from "../../policy/control-flow/binding-projections.js";

export function analyzeRustBindingProjectionEmission(input: {
  readonly program: Omit<RustTargetProgram, "reachability">;
  readonly nodes: readonly Node[];
  readonly producer: RustBindingEmissionProducer;
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  for (const node of input.nodes) {
    const fact = program.records.bindingProjection.get(node);
    if (fact === undefined || !("bindingCarrier" in fact)) continue;
    const name = ast.name(node);
    if (name !== undefined && ast.is.IsIdentifier(name)) {
      const selected = program.names.nameForDeclaration(node);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted binding projection requires its exact declaration name.", node);
      if (!isValidRustIdentifier(selected)) {
        issues.push({ source: "tsonic-rust", category: "error", code: "RUST_UNSUPPORTED_AST", sourceNode: name,
          message: `Binding pattern leaf is not a valid Rust identifier. Node kind: ${ast.kindName(name)}.`, evidence: ["target.capability=rust.backend.binding-name"] });
        continue;
      }
    } else if (name !== undefined && !ast.is.IsArrayBindingPattern(name) && !ast.is.IsObjectBindingPattern(name)) {
      issues.push({ source: "tsonic-rust", category: "error", code: "RUST_UNSUPPORTED_AST", sourceNode: name,
        message: `Binding pattern leaf has no supported finalized Rust binding form. Node kind: ${ast.kindName(name)}.`, evidence: ["target.capability=rust.backend.binding-name"] });
      continue;
    }
    const declaration = sourceEnclosingCallable(ast.parent(node), ast);
    const promiseBody = declaration === undefined ? undefined : program.promiseBodies.declarations.get(declaration);
    const carriers = new Set<TargetTypeRef>([fact.sourceCarrier, fact.bindingCarrier, fact.projectedCarrier]);
    if (fact.sourceCarrier.kind === "tuple") for (const carrier of fact.sourceCarrier.elements) carriers.add(carrier);
    if (fact.sourceCarrier.kind === "array") carriers.add(fact.sourceCarrier.element);
    const fixed = rustFixedArrayCarrierValue(fact.sourceCarrier);
    if (fixed !== undefined) carriers.add(fixed.element);
    if (fact.projection.kind === "object-rest") for (const field of fact.projection.fields) carriers.add(field.carrier);
    const structural = rustStructuralObjectCarrierValue(fact.bindingCarrier);
    if (structural !== undefined) for (const field of structural.fields) carriers.add(field.type);
    const traits = new Map([...carriers].map(carrier => [carrier, Object.freeze({
      copy: isRustCopyCarrier(carrier, selected => program.callableValues.generic.definitionFor(selected)?.copy === true),
      clone: rustCarrierSupportsClone(carrier, program.typeDefinitions) || declaration !== undefined &&
        program.declarationGenericRequirements.supportsClone(declaration, carrier, promiseBody),
    })]));
    const selected = selectRustBindingProjectionEmission(Object.freeze({ fact, traits }));
    if (selected.kind === "invalid") failTargetAnalysisInvariant("tsonic-rust", selected.reason, node);
    if (selected.kind === "rejected") {
      issues.push({ source: "tsonic-rust", category: "error", code: "RUST_MISSING_TARGET_FACT", sourceNode: node,
        message: `${selected.reason} Node kind: ${ast.kindName(node)}.`, evidence: ["target.capability=rust.backend.binding-projection-carrier"] });
      continue;
    }
    input.producer.projection(node, selected.value);
  }
  return Object.freeze(issues);
}
