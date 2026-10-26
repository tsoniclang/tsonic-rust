import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustCallableParameterProducer } from "../program/records/parameter-emission.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";
import { selectRustOptionalDefaultStorage } from "../../policy/conversions/optional-storage.js";
import type { RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import type { RustCallableParameterInitialization } from "../../target-model/records/parameter-emission.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";

type RustParameterEmissionProgram = Pick<RustAnalysisProgram,
  "source" | "sourceNavigation" | "records" | "callableValues" | "projectTypes" | "objectRepresentations" | "names">;

function readRustEntryParameterCarrier(program: RustParameterEmissionProgram, parameter: Node, owner: Node) {
  const carrier = program.records.callableLeading.get(owner)?.sourceParameters.get(parameter);
  if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "An admitted native parameter requires its completed physical entry carrier.", parameter);
  return carrier;
}

function rustParameterReturnInitialization(program: RustParameterEmissionProgram, parameter: Node,
  owner: Node, abi: RustSourceParameterAbiFact, eligible: boolean): RustCallableParameterInitialization {
  const binding = Object.freeze({ kind: "binding" as const });
  const { ast } = program.source;
  if (!eligible || program.records.nativeParticipation.get(owner) === "erased" ||
    program.records.asyncFunction.get(owner) !== undefined || program.records.generator.get(owner) !== undefined) return binding;
  const body = ast.body(owner);
  if (body === undefined) return binding;
  const statements = ast.is.IsBlock(body) ? ast.statements(body) : undefined;
  const returned = statements === undefined ? body
    : statements.length === 1 && statements[0] !== undefined && ast.is.IsReturnStatement(statements[0])
      ? ast.as.AsReturnStatement(statements[0])?.Expression : undefined;
  if (returned === undefined) return binding;
  let reference = returned;
  while (ast.is.IsParenthesizedExpression(reference)) {
    const expression = ast.as.AsParenthesizedExpression(reference)?.Expression;
    if (expression === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted parameter return requires its exact parenthesized expression.", reference);
    reference = expression;
  }
  if (!ast.is.IsIdentifier(reference) || program.sourceNavigation.sourceReferenceFor(reference)?.declaration !== parameter) return binding;
  const parameters = ast.parameters(owner);
  const parameterIndex = parameters.indexOf(parameter);
  if (parameterIndex < 0) failTargetAnalysisInvariant("tsonic-rust",
    "An admitted parameter return requires its exact callable parameter position.", parameter);
  const selectedReturn = program.records.callableReturn.get(owner);
  const sourceReturn = program.records.sourceCallableReturn.get(owner);
  const read = program.records.readOwnership.get(returned);
  const carrier = program.records.runtimeCarrier.get(returned)?.carrier;
  if (selectedReturn === undefined || sourceReturn === undefined || read === undefined || carrier === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted parameter return requires its complete native return and read contracts.", returned);
  if (selectedReturn.destination.kind !== "identity" || sourceReturn.borrowedParameter !== undefined ||
    !rustTargetTypeRefEquals(carrier, abi.valueCarrier) || !rustTargetTypeRefEquals(sourceReturn.returnCarrier, abi.valueCarrier) ||
    read.value.kind !== "copy" && read.value.kind !== "move") return binding;
  const dropFree = (carrier: RustSourceParameterAbiFact["parameterCarrier"]): boolean =>
    carrier.kind === "reference" || isRustCopyCarrier(carrier,
      selected => program.callableValues.generic.definitionFor(selected)?.copy === true);
  for (const [otherIndex, other] of parameters.entries()) {
    if (other === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted parameter return requires its complete checked parameter vector.", owner);
    if (other === parameter) continue;
    const otherAbi = program.records.sourceParameterAbi.get(other);
    if (otherAbi === undefined) continue;
    const name = ast.name(other);
    if (otherAbi.entryConversion !== undefined || name !== undefined &&
      (ast.is.IsObjectBindingPattern(name) || ast.is.IsArrayBindingPattern(name))) return binding;
    if (otherIndex > parameterIndex && (otherAbi.form === "default" || program.records.bindingStorage.get(other) !== undefined)) return binding;
    if (abi.form === "default" && (program.records.bindingStorage.get(other) !== undefined ||
      !dropFree(readRustEntryParameterCarrier(program, other, owner)) || !dropFree(otherAbi.valueCarrier))) return binding;
  }
  if (abi.form === "default") {
    const lexical = program.records.lexicalFunction.get(owner);
    if (lexical?.captures.some(capture => !dropFree(capture.parameterCarrier))) return binding;
    const operation = program.records.targetOperation.get(owner);
    if (operation?.kind === "closure") {
      const capture = program.records.closureCapture.get(owner);
      if (capture === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted closure parameter return requires its complete native environment contract.", owner);
      if (capture.captures.length !== 0 || capture.receivers.length !== 0 || capture.receiverFields.length !== 0 ||
        operation.leadingParameters?.some(parameter => !dropFree(parameter.carrier)) ||
        operation.ignoredParameterCarriers.some(carrier => !dropFree(carrier))) return binding;
    }
  }
  return Object.freeze({ kind: "return", expression: returned, carrier });
}

export function analyzeRustCallableParameterEmission(input: {
  readonly program: RustParameterEmissionProgram;
  readonly nodes: readonly Node[];
  readonly producer: RustCallableParameterProducer;
  readonly required: RustRequiredRecord[];
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
    const carrier = readRustEntryParameterCarrier(program, parameter, owner);
    const sourceCarrier = program.records.runtimeCarrier.get(parameter)?.carrier;
    const storage = program.records.bindingStorage.get(parameter);
    if (pattern !== undefined && (sourceCarrier === undefined || !rustTargetTypeRefEquals(sourceCarrier, abi.valueCarrier) || storage !== undefined))
      failTargetAnalysisInvariant("tsonic-rust", "Binding-pattern parameters require their exact Rust source value and selected native entry carrier.", parameter);
    if (storage !== undefined && !rustTargetTypeRefEquals(abi.valueCarrier, storage.valueCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted promoted parameter requires its exact finalized value carrier.", parameter);
    const owned = carrier.kind !== "pointer" && carrier.kind !== "reference";
    const mutable = pattern === undefined && storage === undefined && (program.records.mutatedBinding.get(parameter) !== undefined ||
      owned && program.records.mutatedReferentBinding.get(parameter) !== undefined);
    const initializer = abi.form === "default" ? ast.as.AsParameterDeclaration(parameter)?.Initializer : undefined;
    if (abi.form === "default" && initializer === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native default-parameter ABI requires its exact authored initializer.", parameter);
    input.producer.parameter(parameter, { carrier, name, pattern, sourceCarrier, storage, mutable,
      parameterMutable: abi.form !== "default" && abi.entryConversion === undefined && mutable,
      initialization: rustParameterReturnInitialization(program, parameter, owner, abi,
        pattern === undefined && storage === undefined && !mutable && abi.entryConversion === undefined),
      default: initializer === undefined ? undefined : Object.freeze({ initializer, valueCarrier: abi.valueCarrier,
        retainStorage: selectRustOptionalDefaultStorage(Object.freeze({ storage: carrier, result: abi.valueCarrier })) }),
    });
    requireRustRecord(input.required, "callableParameter", parameter, "native callable parameter", "analyzeRustCallableParameterEmission");
  }
}
