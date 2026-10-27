import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "./compile-time-statements.js";
import { Node_Initializer, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustBindingEmissionProducer } from "../program/records/storage/binding-emission.js";
import type { RustBindingValueProjectionFact, RustSelectedBindingProjection } from "../../target-model/records/objects/value-projections.js";
import { rustFixedArrayCarrierValue, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { selectRustBindingProjectionEmission } from "../../policy/operations/control-flow/binding-projections.js";
import { selectRustBindingPatternProjection } from "../../policy/types/objects/binding-projection-policy.js";
import { rustBindingNormalizationContract } from "../../policy/types/storage/binding-normalization.js";

export function analyzeRustBindingProjectionEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly nodes: readonly Node[];
  readonly producer: RustBindingEmissionProducer;
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const physicalFacts = new Map<Node, RustBindingValueProjectionFact>();
  const nativeValue = (node: Node): TargetTypeRef => {
    const selection = program.callableValues.nativeStorage.valueFor(node);
    if (selection.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust", selection.reason, node);
    return selection.carrier;
  };
  const physicalFact = (node: Node, logical: RustBindingValueProjectionFact): RustBindingValueProjectionFact => {
    const previous = physicalFacts.get(node);
    if (previous !== undefined) return previous;
    const pattern = ast.parent(node);
    const owner = pattern === undefined ? undefined : ast.parent(pattern);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted binding requires its exact source pattern owner.", node);
    let sourceCarrier: TargetTypeRef;
    if (ast.is.IsBindingElement(owner)) {
      const parent = program.records.bindingProjection.get(owner);
      if (parent === undefined || !("bindingCarrier" in parent))
        failTargetAnalysisInvariant("tsonic-rust", "A nested binding requires its complete native parent projection.", owner);
      sourceCarrier = physicalFact(owner, parent).bindingCarrier;
    } else sourceCarrier = nativeValue(owner);
    const initializer = Node_Initializer(ast, node);
    const defaultCarrier = initializer === undefined ? undefined : nativeValue(initializer);
    const projection = logical.projection;
    let selected: RustSelectedBindingProjection | undefined;
    if (projection.kind === "object-field" || projection.kind === "object-rest") {
      const structural = rustStructuralObjectCarrierValue(sourceCarrier);
      const definition = program.projectTypes.definitionForCarrier(sourceCarrier);
      const fields = projection.storage === "project-object" && definition !== undefined
        ? program.records.projectClassFields.get(definition, sourceCarrier) : undefined;
      const fieldCarrier = (index: number): TargetTypeRef | undefined => projection.storage === "structural-object"
        ? structural?.fields[index]?.type : fields?.find(field => field.storageIndex === index)?.carrier;
      if (projection.kind === "object-field") {
        const projectedCarrier = fieldCarrier(projection.storageIndex);
        if (projectedCarrier !== undefined) selected = { projectedCarrier, projection };
      } else {
        const fields = projection.fields.map(field => {
          const carrier = fieldCarrier(field.sourceStorageIndex);
          return carrier === undefined ? undefined : Object.freeze({ ...field, carrier });
        });
        if (fields.every(field => field !== undefined)) selected = { projectedCarrier: nativeValue(node),
          projection: Object.freeze({ ...projection, fields: Object.freeze(fields) }) };
      }
    } else {
      const rest = "start" in projection;
      selected = selectRustBindingPatternProjection(sourceCarrier, rest ? projection.start : projection.index,
        rest, initializer !== undefined);
    }
    const normalized = selected === undefined ? undefined
      : rustBindingNormalizationContract(selected.projectedCarrier, defaultCarrier, selected.checkedArrayElement);
    if (selected === undefined || normalized === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted binding requires its exact completed physical source projection.", node);
    const fact = Object.freeze({ sourceCarrier, projectedCarrier: selected.projectedCarrier,
      projection: selected.projection, ...normalized });
    physicalFacts.set(node, fact);
    return fact;
  };
  for (const node of input.nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const logical = program.records.bindingProjection.get(node);
    if (logical === undefined || !("bindingCarrier" in logical)) continue;
    const fact = physicalFact(node, logical);
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
        program.declarationGenericRequirements.supportsClone(declaration, carrier, promiseBody === undefined ? undefined : true),
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
