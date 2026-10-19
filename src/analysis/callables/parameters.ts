import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustCallableParameterProducer } from "../program/records/parameter-emission.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustCarrierReferentMutationRequiresMutableBinding } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustCallableParameterEmission(input: {
  readonly program: Pick<RustTargetProgram, "source" | "records" | "callableValues" | "projectTypes" | "objectRepresentations" | "names">;
  readonly nodes: readonly Node[];
  readonly producer: RustCallableParameterProducer;
}): void {
  const { program } = input;
  const { ast } = program.source;
  for (const parameter of input.nodes) {
    if (!ast.is.IsParameterDeclaration(parameter)) continue;
    const abi = program.records.sourceParameterAbi.get(parameter);
    if (abi === undefined) continue;
    const owner = ast.parent(parameter);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native parameter requires its checked callable owner.", parameter);
    const nameNode = ast.name(parameter);
    const pattern = nameNode !== undefined && (ast.is.IsObjectBindingPattern(nameNode) || ast.is.IsArrayBindingPattern(nameNode)) ? nameNode : undefined;
    const name = pattern === undefined ? program.names.nameForDeclaration(parameter) : undefined;
    if (pattern === undefined && (name === undefined || !isValidRustIdentifier(name))) failTargetAnalysisInvariant("tsonic-rust", "An admitted native parameter requires its exact native identifier.", parameter);
    const requiresImplementation = program.callableValues.native.inputsFor(owner).some(input => input.subject.node === parameter);
    const physical = requiresImplementation ? program.callableValues.nativeStorage.parameterFor(parameter) : undefined;
    if (physical?.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted native parameter requires its finalized physical callable storage.", parameter);
    const carrier = physical?.carrier ?? abi.parameterCarrier;
    const sourceCarrier = program.records.runtimeCarrier.get(parameter)?.carrier;
    const storage = program.records.bindingStorage.get(parameter);
    if (pattern !== undefined && (abi.mode !== "value" || sourceCarrier === undefined || !rustTargetTypeRefEquals(sourceCarrier, abi.valueCarrier) || storage !== undefined))
      failTargetAnalysisInvariant("tsonic-rust", "Binding-pattern parameters require one exact by-value Rust source and initialized value carrier.", parameter);
    if (storage !== undefined && !rustTargetTypeRefEquals(abi.valueCarrier, storage.valueCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted promoted parameter requires its exact finalized value carrier.", parameter);
    const owned = carrier.kind !== "pointer" && carrier.kind !== "reference";
    const mutableReferent = rustCarrierReferentMutationRequiresMutableBinding(carrier, selected => {
      const representation = program.objectRepresentations.representationFor(program.projectTypes.definitionForCarrier(selected));
      return representation !== undefined && representation.kind !== "value";
    });
    const mutable = pattern === undefined && storage === undefined && (program.records.mutatedBinding.get(parameter) !== undefined ||
      owned && mutableReferent && program.records.mutatedReferent.get(parameter) !== undefined);
    const initializer = abi.form === "default" ? ast.as.AsParameterDeclaration(parameter)?.Initializer : undefined;
    if (abi.form === "default" && initializer === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native default-parameter ABI requires its exact authored initializer.", parameter);
    input.producer.parameter(parameter, { carrier, name, pattern, sourceCarrier, storage, mutable,
      parameterMutable: abi.form !== "default" && abi.entryConversion === undefined && mutable,
      default: initializer === undefined ? undefined : Object.freeze({ initializer, valueCarrier: abi.valueCarrier }),
    });
  }
}
