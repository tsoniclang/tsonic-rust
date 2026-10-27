import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals, hasExactObjectKeys } from "../../target-model/metadata/closed-data.js";
import { isRustCapturedFieldStorage } from "../../target-model/types/field-storage.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { selectRustCapturedFieldStorage } from "../../policy/ownership/captured-field-storage.js";
import type { RustCapturedFieldStorageFact } from "../../target-model/records/callables/receiver-captures.js";
import type { RustReceiverCaptureEmissionProducer } from "../program/records/callables/receiver-captures.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustClosureCaptureEquals } from "../../target-model/records/operations/equality.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustCallableTargetForSourceLifetime } from "../../policy/conversions/value-carrier-reconciliation.js";

export function validatedRustCapturedFieldStorageFact(
  declaration: Node,
  program: Pick<RustAnalysisProgram, "objectRepresentations"> & { readonly records: RustProgramRecords },
): RustCapturedFieldStorageFact | undefined {
  const fact = program.records.capturedFieldStorage.get(declaration);
  const captures = program.objectRepresentations.receiverCaptures;
  const carrier = program.records.runtimeCarrier.get(declaration)?.carrier;
  const storageCarrier = program.records.runtimeCarrier.get(captures.storageDeclaration(declaration))?.carrier;
  return captures.isCaptured(declaration) && fact !== undefined &&
    hasExactObjectKeys(fact, ["storage", "valueCarrier"]) && isRustCapturedFieldStorage(fact.storage) &&
    carrier !== undefined && storageCarrier !== undefined && rustTargetTypeRefEquals(fact.valueCarrier, carrier) &&
    closedMetadataEquals(selectRustCapturedFieldStorage(storageCarrier,
      captures.storageReadonly(declaration), captures.isDeferred(declaration), captures.storageImmutable(declaration)), fact.storage) ? fact : undefined;
}

export function analyzeRustReceiverCaptureEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustReceiverCaptureEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    const capture = program.records.closureCapture.get(node);
    if (capture === undefined) continue;
    const receivers = program.objectRepresentations.receiverCaptures.receiversFor(node);
    if (receivers.length !== capture.receivers.length || !receivers.every((source, index) => {
      const selected = capture.receivers[index];
      const definition = selected === undefined ? undefined : program.projectTypes.definitionForCarrier(selected.carrier);
      const representation = program.objectRepresentations.representationFor(definition);
      return selected !== undefined && representation !== undefined && representation.kind !== "value" &&
        source.owner === selected.owner && source.reference === selected.reference && source.references.length === selected.references.length &&
        source.references.every((reference, offset) => reference === selected.references[offset] &&
          rustTargetTypeRefEquals(program.records.runtimeCarrier.get(reference)?.carrier, selected.carrier));
    })) refuse(node, "rust.backend.receiver-capture", "A retained native receiver differs from its sealed owner, source references or carrier.");
    const fields = program.objectRepresentations.receiverCaptures.capturesFor(node);
    if (fields.length !== capture.receiverFields.length || !fields.every((source, index) => {
      const selected = capture.receiverFields[index];
      return selected !== undefined && source.declaration === selected.declaration && source.receiver === selected.receiver &&
        source.reference === selected.reference && source.references.length === selected.references.length &&
        source.references.every((reference, offset) => reference === selected.references[offset] &&
          rustTargetTypeRefEquals(program.records.runtimeCarrier.get(reference)?.carrier, selected.carrier)) &&
        closedMetadataEquals(program.records.capturedFieldStorage.get(selected.declaration)?.storage, selected.storage);
    })) refuse(node, "rust.backend.receiver-field-capture", "A live receiver field capture differs from its sealed source membership, carrier and physical storage.");
    const fixed = program.objectRepresentations.receiverCaptures.fixedSelfFor(node);
    const operation = program.records.targetOperation.get(node);
    const field = capture.recursiveField;
    const carrier = operation?.kind === "closure" ? operation.resultCarrier : program.records.runtimeCarrier.get(node)?.carrier;
    for (const binding of capture.captures) {
      const source = program.records.sourceBinding.get(binding.reference);
      const functionValue = source !== undefined && program.source.ast.is.IsFunctionDeclaration(source.sourceDeclaration) &&
        program.lexicalFunctions.forDeclaration(source.sourceDeclaration) !== undefined;
      const lexicalBinding = source === undefined || !functionValue ? undefined : program.names.callableValueNameForDeclaration(source.sourceDeclaration);
      const name = source === undefined ? undefined : functionValue ? lexicalBinding : program.records.sourceBindingEmission.get(source.sourceDeclaration)?.name;
      if (source === undefined || name === undefined || !isValidRustIdentifier(name)) {
        refuse(node, "rust.backend.closure-captures", "Callable expressions require finalized exact capture evidence.");
        continue;
      }
      if (binding.mutable === true && (binding.storage !== "value" || operation?.kind !== "closure" ||
        operation.resultCarrier.kind !== "closure" || operation.resultCarrier.callTrait !== "FnMut" && operation.resultCarrier.callTrait !== "FnOnce")) {
        refuse(node, "rust.backend.native-mutable-capture", "A mutable value capture requires its exact owning native callable contract.");
        continue;
      }
      producer.environment(node, binding.reference, { name, lexicalBinding });
    }
    if (!rustClosureCaptureEquals(capture, capture) || (fixed === undefined ? field !== undefined : field === undefined ||
      fixed.declaration !== field.declaration || capture.recursiveDeclaration !== field.declaration || capture.invocationOwner !== undefined ||
      capture.captures.length !== 0 || capture.receivers.length !== 0 || capture.receiverFields.length !== 0 ||
      fixed.reference !== field.reference || fixed.receiver !== field.receiver || carrier === undefined ||
      !rustTargetTypeRefEquals(rustCallableTargetForSourceLifetime(carrier, field.carrier), carrier) ||
      fixed.references.length !== field.references.length || !fixed.references.every((reference, index) => reference === field.references[index] &&
        rustTargetTypeRefEquals(program.records.runtimeCarrier.get(reference)?.carrier, field.carrier))))
      refuse(node, "rust.backend.fixed-field-self", "A fixed field self differs from its sealed origin, source references or exact callable carrier.");
    for (const field of capture.receiverFields) {
      if (producer.records.capturedFieldIdentity.get(field.declaration, field.reference) !== undefined) continue;
      producer.publish(field.declaration, field.reference, program.frozenDataWrites.capturesFieldIdentity(field.declaration, field.reference));
    }
  }
  return Object.freeze(issues);
}
