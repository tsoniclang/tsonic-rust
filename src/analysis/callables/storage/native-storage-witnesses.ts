import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindingsSelection, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { asSourceNode, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustNativeCallableInput } from "../../../target-model/records/native/native-protocols.js";
import type { RustSourceCallParameterPlan } from "../../../target-model/operations/model.js";
import type { RustSourceCallableSpecializationIssue } from "../../../target-model/records/callables/callable-issues.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import { callableValueCarrier } from "./native-storage-values.js";
import type { RustStructuralStorageLookup } from "../../../policy/model/operation-record-inputs.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier } from "../../../target-model/types/carriers/native.js";
import { isRustNeverCarrier } from "../../../target-model/types/carriers/js.js";
import { rustNativeCallableAbsenceWitness } from "../../../policy/conversions/native-callables.js";
import { rustTargetGenericBindingsForArguments } from "../../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { createRustEffectsWorkBudget } from "../../errors/effects-work-budget.js";

interface RustNativeStorageSourceInput {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly structuralShapes: RustStructuralStorageLookup;
  readonly definitions: RustTypeDefinitions;
  readonly native: RustNativeCallableInputPlan;
}

// Callable adapters recorded on values are frontier stops of the storage they are written into.
export function selectRustNativeConversionBoundaries(input: RustNativeStorageSourceInput): {
  readonly boundaries: readonly SourceStorageSubject[];
  readonly adaptedReferences: ReadonlyMap<Node, readonly { readonly node: Node; readonly subject: SourceStorageSubject }[]>;
  readonly failure: string | undefined;
} {
  const conversionBoundaries: SourceStorageSubject[] = [];
  // Source storage transports an identifier operand as its declaration, so a callable adapter recorded on an identifier
  // reference is never reached as a frontier boundary. Index those adapted references by the declaration they name.
  const adaptedReferences = new Map<Node, { readonly node: Node; readonly subject: SourceStorageSubject }[]>();
  let failure: string | undefined;
  for (const node of input.nativeNodes) {
    const operation = input.records.targetOperation.get(node);
    const field = operation?.kind === "source-field" && operation.storage === "structural-object"
      ? input.structuralShapes.field(operation.receiverCarrier, operation.storageIndex) : undefined;
    const value = operation?.kind === "source-field" ? callableValueCarrier(operation.resultCarrier) : undefined;
    const getter = operation?.kind === "source-field" && field?.storage === "property" && field.method !== true &&
      value !== undefined && rustCallableProtocol(value) !== undefined;
    const boundMethod = operation?.kind === "source-method-property" &&
      (operation.accessMode === "read" || operation.accessMode === "read-write");
    const adapter = input.records.contextualValueConversion.get(node)?.conversion.kind === "callable-adapter";
    if (!getter && !boundMethod && !adapter) continue;
    const selected = input.storage.subject(node, "value");
    if (selected.kind === "unresolved") { failure ??= selected.reason; continue; }
    const declaration = input.ast.is.IsIdentifier(node)
      ? input.storage.source.navigation.sourceReferenceFor(node)?.declaration : undefined;
    // A reference to a native callable input is transported as the input itself and is never on a frontier; any other
    // adapted reference (a local binding read) is a frontier stop of the storage it is written into.
    if (getter || boundMethod || declaration === undefined || !input.native.isConcreteCallableParameter(declaration) &&
      !input.native.inputs.some(candidate => candidate.subject.node === declaration)) {
      conversionBoundaries.push(selected.subject);
      continue;
    }
    // A query of the reference itself reads the declaration's unconverted value, so it is not a frontier stop.
    const references = adaptedReferences.get(declaration) ?? [];
    references.push({ node, subject: selected.subject });
    adaptedReferences.set(declaration, references);
  }
  return { boundaries: Object.freeze(conversionBoundaries), adaptedReferences, failure };
}

// An absent value passed for an optional native callable input takes a witness implementation type at that call.
export function collectRustNativeAbsenceWitnesses(input: RustNativeStorageSourceInput,
  invocationBindingsFor: (implementation: Node, invocation: Node) => SourceStorageBindingsSelection): {
  readonly absenceWitnesses: ReadonlyMap<Node, ReadonlyMap<RustNativeCallableInput, TargetTypeRef>>;
  readonly argumentWitnesses: ReadonlyMap<Node, ReadonlyMap<Node, TargetTypeRef>>;
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
} {
  const absenceWitnesses = new Map<Node, Map<RustNativeCallableInput, TargetTypeRef>>();
  const argumentWitnesses = new Map<Node, Map<Node, TargetTypeRef>>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const witnessBudget = createRustEffectsWorkBudget();
  let witnessSubject: Node | undefined;
  const witnessFailure = witnessBudget.run(() => { for (const invocation of input.storage.invocations) {
    witnessSubject = invocation;
    witnessBudget.step();
    const operation = input.records.targetOperation.get(invocation);
    const signature = input.records.selectedCall.get(invocation);
    const declaration = asSourceNode(signature?.sourceDeclaration, input.ast);
    if (operation?.kind !== "source-call" || signature === undefined || declaration === undefined) continue;
    for (const selected of input.native.inputsFor(declaration)) {
      witnessBudget.step();
      if (rustOptionElementCarrier(selected.carrier) === undefined) continue;
      const ownerParameters = sourceCallableValueParameters(input.ast, selected.owner, input.storage.source.semantics.forNode(selected.owner));
      if (ownerParameters === undefined) {
        issues.push({ subject: selected.owner, message: "Optional callable witnesses require exact checked value parameters." });
        continue;
      }
      if (!omittedOptionalInput(ownerParameters, operation.parameters, selected)) {
        const bindings = invocationBindingsFor(selected.owner, invocation);
        const origins = bindings.kind === "unresolved" ? bindings : input.storage.boundOriginsFor(selected.subject, bindings.bindings);
        if (origins.kind !== "resolved" || origins.subjects.length === 0 || origins.subjects.some(subject => subject.projection.length !== 0 ||
          !isRustAbsenceCarrier(input.records.runtimeCarrier.get(subject.node)?.carrier) &&
          !(subject.kind === "return" && isRustNeverCarrier(input.records.sourceCallableReturn.get(subject.node)?.returnCarrier)))) continue;
      }
      const prototype = rustNativeCallableAbsenceWitness(selected, input.definitions);
      const generics = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], operation.targetGenericArguments ?? []);
      if (prototype === undefined || generics === undefined) continue;
      const witness = snapshotClosedMetadata(substituteRustTargetGenerics(prototype, generics.types, generics.lifetimes, generics.consts));
      witnessBudget.metadata(witness);
      const witnesses = absenceWitnesses.get(invocation) ?? new Map<RustNativeCallableInput, TargetTypeRef>();
      witnesses.set(selected, witness);
      absenceWitnesses.set(invocation, witnesses);
      if (selected.subject.projection.length === 0) {
        const index = ownerParameters.indexOf(selected.subject.node);
        for (const supplied of operation.parameters[index]?.inputs ?? []) {
          witnessBudget.step();
          if (supplied.sourceForm !== "value") continue;
          const argument = input.ast.arguments(invocation)[supplied.sourceArgumentIndex];
          if (argument === undefined) continue;
          const arguments_ = argumentWitnesses.get(invocation) ?? new Map<Node, TargetTypeRef>();
          arguments_.set(argument, snapshotClosedMetadata(rustSourceOptionalTargetType(witness)));
          argumentWitnesses.set(invocation, arguments_);
        }
      }
    }
  } });
  return { absenceWitnesses, argumentWitnesses, issues: Object.freeze([...issues, ...(witnessFailure === undefined || witnessSubject === undefined ? [] : [{
    subject: witnessSubject, message: witnessFailure.message,
  }])]) };
}

// An optional callable parameter the invocation supplies no argument for is absent at that call; no source node carries
// its absence.
function omittedOptionalInput(ownerParameters: readonly Node[], parameters: readonly RustSourceCallParameterPlan[], selected: RustNativeCallableInput): boolean {
  if (selected.subject.projection.length !== 0) return false;
  const plan = parameters[ownerParameters.indexOf(selected.subject.node)];
  return plan?.form === "optional" && plan.inputs.length === 0;
}
