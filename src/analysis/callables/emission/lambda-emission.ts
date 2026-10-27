import type { Node } from "@tsonic/tsts";
import { asSourceNode, BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { rustProgramNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustLambdaEmissionProducer } from "../../program/records/callables/lambda-emission.js";
import type { RustLambdaParameterEmission } from "../../../target-model/records/callables/lambda-emission.js";
import { rustCallableProtocol, rustClosureProtocol, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { rustCallableInputProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustCallablePhysicalSignature } from "../../../target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { finalizedConversionIsValid } from "../../../policy/operations/members/abi/conversions.js";
import { rustCallableWithError, rustUninhabitedError } from "../../../policy/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustCallableTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/carriers/js.js";
import { rustJsArrayLikeElementTargetType } from "../../../target-model/types/carriers/js.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustFixedStructuralMethodDeclarations } from "../generics/generic-values.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";
import { rustRuntimeErrorTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { rustErrorRegionCarrier } from "../../errors/regions.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import { admitRustConversionEmission } from "../../conversions/emission.js";
import type { RustConversionEmissionProducer } from "../../program/records/operations/conversion-emission.js";
import type { RustValueConversionContract } from "../../../target-model/conversions/contracts.js";

export function analyzeRustLambdaEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustLambdaEmissionProducer,
  conversions: RustConversionEmissionProducer): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const fixedMethods = rustFixedStructuralMethodDeclarations(ast, program.structuralShapes);
  const issues: TargetDiagnostic[] = [];
  const reject = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_UNSUPPORTED_AST", source: "tsonic-rust", category: "error", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (fixedMethods.has(node) || rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const closure = program.records.targetOperation.get(node);
    if (closure?.kind !== "closure" || program.records.nativeParticipation.get(node) === "erased") continue;
    const captures = program.records.closureCapture.get(node);
    if (captures === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable requires its exact capture evidence.", node);
    const frame = program.records.frameImplementation.get(node);
    const independentCarrier = frame?.independent === true ? program.records.frameType.get(closure.resultCarrier)?.independentCarrier : undefined;
    if (frame?.independent === true && independentCarrier === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An independent frame callable requires its exact native carrier.", node);
    const constructionCarrier = independentCarrier ?? program.records.receiverIndependentMethod.get(node)?.carrier ?? closure.resultCarrier;
    const construction = rustFrameCallableValue(constructionCarrier) !== undefined ? "frame"
      : rustGenericCallableValue(constructionCarrier) !== undefined ? "generic" : "native";
    const sourceProtocol = rustCallableProtocol(closure.resultCarrier);
    const protocol = rustCallableProtocol(constructionCarrier);
    const nativeClosure = rustClosureProtocol(closure.resultCarrier);
    const parameters = closure.resultCarrier.kind === "function-pointer" ? closure.resultCarrier.args
      : nativeClosure?.parameters ?? sourceProtocol?.parameters;
    const resultCarrier = closure.resultCarrier.kind === "function-pointer" ? closure.resultCarrier.result
      : nativeClosure?.result ?? sourceProtocol?.result;
    if (construction !== "native") {
      producer.lambda(node, { construction, constructionCarrier });
      continue;
    }
    if (closure.resultCarrier.kind === "function-pointer" && (captures.captures.length !== 0 || captures.receiverFields.length !== 0 ||
      captures.receivers.length !== 0 || captures.recursiveDeclaration !== undefined)) {
      reject(node, "rust.backend.function-pointer-capture", "Native Rust function pointers cannot carry captured or recursive callable state.");
      continue;
    }
    if (nativeClosure !== undefined && captures.recursiveDeclaration !== undefined) {
      reject(node, "rust.backend.native-closure-recursion", "A native Rust closure passed to a provider operation cannot recursively invoke itself.");
      continue;
    }
    const sourceParameters = program.records.callableDeclaration.get(node)?.contract.parameters;
    if (sourceParameters === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its exact checked value parameters.", node);
    const leading = closure.leadingParameters ?? [];
    if (parameters === undefined || resultCarrier === undefined || leading.length > parameters.length ||
      !leading.every((parameter, index) => rustTargetTypeRefEquals(parameter.carrier, parameters[index])) ||
      closure.byRefCopyParams.length !== sourceParameters.length ||
      parameters.length - leading.length !== sourceParameters.length + closure.ignoredParameterCarriers.length ||
      !closure.ignoredParameterCarriers.every((carrier, index) => rustTargetTypeRefEquals(carrier, parameters[leading.length + sourceParameters.length + index])))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its exact receiver and source parameter ABI.", node);
    // A receiver-independent construction carrier takes only the parameters after the leading (receiver) parameters.
    const constructed = constructionCarrier === closure.resultCarrier ? parameters : parameters.slice(leading.length);
    if (protocol !== undefined && (!rustTargetTypeRefEquals(protocol.result, resultCarrier) ||
      protocol.parameters.length !== constructed.length || !protocol.parameters.every((carrier, index) => rustTargetTypeRefEquals(carrier, constructed[index]))))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its exact native construction parameter and result ABI.", node);
    const selected: RustLambdaParameterEmission[] = sourceParameters.map((parameter, index) => {
      if (parameter === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires dense source parameter slots.", node);
      const carrier = parameters[leading.length + index]!;
      const abi = program.records.sourceParameterAbi.get(parameter);
      if (abi === undefined || !rustTargetTypeRefEquals(carrier, abi.parameterCarrier) ||
        protocol === undefined && closure.parameterForms === "required-only" && abi.form !== "required")
        failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its finalized parameter carrier and form.", parameter);
      const name = ast.name(parameter);
      const pattern = name !== undefined && (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name)) ? name : undefined;
      const byRefCopy = closure.byRefCopyParams[index] === true;
      if (pattern !== undefined && byRefCopy) failTargetAnalysisInvariant("tsonic-rust", "An admitted binding-pattern closure requires one exact by-value carrier.", parameter);
      const owned = carrier.kind !== "pointer" && carrier.kind !== "reference";
      return Object.freeze({ declaration: parameter, carrier, valueCarrier: abi.valueCarrier, form: abi.form,
        pattern, byRefCopy, mutable: pattern === undefined && (program.records.mutatedBinding.get(parameter) !== undefined ||
          owned && program.records.mutatedReferentBinding.get(parameter) !== undefined) });
    });
    const generator = program.records.generator.get(node);
    const asynchronous = program.records.asyncFunction.get(node);
    const region = program.records.nativeErrorRegion.get(node);
    if (region === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its finalized native error region.", node);
    const fallible = region.kind !== "infallible";
    const suspended = generator !== undefined || asynchronous !== undefined;
    if (ast.hasModifierKind(node, "async") && !suspended)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted async callable requires sealed suspension evidence.", node);
    if (generator !== undefined && fallible) {
      reject(node, "rust.backend.generator-fallibility", "Throwing generator bodies require a closed Rust generator error protocol.");
      continue;
    }
    const borrowedInput = rustCallableInputProtocol(constructionCarrier) !== undefined;
    const physicalCarrier = protocol === undefined ? undefined : program.callableValues.nativeProducers.physicalFor(node, constructionCarrier);
    const resultFallible = protocol !== undefined || nativeClosure?.fallible === true || fallible;
    const invocationError = !resultFallible ? undefined : protocol === undefined || borrowedInput
      ? program.callableValues.nativeProducers.errorFor(node, "invoke")
      : physicalCarrier === undefined ? undefined : rustCallablePhysicalSignature(physicalCarrier)?.error;
    if (resultFallible && invocationError === undefined || protocol !== undefined && physicalCarrier === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its producer-owned physical invocation ABI.", node);
    const bodyCarrier = generator?.returnType ?? asynchronous?.outputCarrier ?? resultCarrier;
    const body = ast.body(node);
    const sourceReturn = program.records.sourceCallableReturn.get(node);
    if (body === undefined || sourceReturn === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted closure requires its source body and return completion evidence.", node);
    if (!isRustUnitCarrier(bodyCarrier) && generator === undefined && sourceReturn.canFallThrough === true && !sourceReturn.fallthroughUndefined) {
      reject(body, "rust.backend.closure-return-flow", "Value-returning callable expressions require finalized control flow that returns on every path.");
      continue;
    }
    if (closure.invocationResult !== undefined && (!finalizedConversionIsValid(closure.invocationResult, program.typeDefinitions) ||
      !rustTargetTypeRefEquals(closure.invocationResult.sourceCarrier, generator?.resultCarrier ?? asynchronous?.futureCarrier) ||
      !rustTargetTypeRefEquals(closure.invocationResult.targetCarrier, resultCarrier) || asynchronous?.kind === "native-future"))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted suspended closure requires its exact result conversion.", node);
    const producedReference = rustProducerErrorReference(invocationError);
    const producedError = producedReference === undefined ? invocationError : program.errorRegions.producerError(producedReference);
    if (nativeClosure !== undefined && resultFallible && producedError === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted native closure requires its completed physical invocation error.", node);
    let bodyErrorConversion: RustValueConversionContract | undefined;
    if (!suspended && fallible) {
      const bodyError = rustErrorRegionCarrier(region);
      if (bodyError === undefined || producedError === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted callable body requires its exact intrinsic and outward error carriers.", node);
      if (!rustTargetTypeRefEquals(bodyError, producedError)) {
        const conversion = selectRustSourceValueConversion(bodyError, producedError, program.typeDefinitions);
        if (conversion === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "An admitted callable construction requires its exact intrinsic-body error conversion.", node);
        bodyErrorConversion = admitRustConversionEmission(conversions, conversion, program.typeDefinitions);
        if (bodyErrorConversion.fallible || bodyErrorConversion.category !== "exact" || bodyErrorConversion.sourceMode !== "value" ||
          !rustTargetTypeRefEquals(bodyErrorConversion.source, bodyError) || !rustTargetTypeRefEquals(bodyErrorConversion.target, producedError))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted callable construction requires an exact infallible body error conversion.", node);
      }
    }
    const nativeInvocationError = producedError === undefined ? undefined : mapRustTargetTypes(producedError, carrier => {
      const owner = rustProgramErrorOwner(carrier);
      return owner?.kind === "physical" && owner.domain === "runtime" ? rustRuntimeErrorTargetType() : carrier;
    });
    const familyError = frame?.independent === true ? protocol?.error : fixedErasedSlotError(program, node);
    const independentWrite = physicalCarrier === undefined || familyError === undefined || producedError === undefined ||
      !rustUninhabitedError(producedError) || rustUninhabitedError(familyError) ? undefined
      : rustCallableWithError(physicalCarrier, familyError);
    if (familyError !== undefined && producedError !== undefined && rustUninhabitedError(producedError) &&
      !rustUninhabitedError(familyError) && independentWrite === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "A closure written into a fixed callable slot requires the slot's exact callable error.", node);
    producer.lambda(node, { construction, constructionCarrier, protocol, nativeClosure, borrowedInput, parameters: Object.freeze(selected),
      resultCarrier, bodyCarrier, unitBody: isRustUnitCarrier(bodyCarrier), physicalCarrier,
      invocationError: nativeClosure === undefined ? invocationError : nativeInvocationError,
      bodyErrorConversion,
      resultFallible, bodyFallible: suspended ? fallible : resultFallible,
      staticStorage: protocol?.lifetime?.kind === "static", mutableCapture: closure.resultCarrier.kind === "closure" &&
        (closure.resultCarrier.callTrait === "FnMut" || closure.resultCarrier.callTrait === "FnOnce"),
      independentWrite: independentWrite === undefined || physicalCarrier === undefined ? undefined
        : Object.freeze({ source: physicalCarrier, carrier: independentWrite }) });
  }
  return Object.freeze(issues);
}

function fixedErasedSlotError(program: Omit<RustAnalysisProgram, "reachability">, node: Node): TargetTypeRef | undefined {
  const { ast } = program.source;
  let value = node;
  for (let parent = ast.parent(value); parent !== undefined && ast.is.IsParenthesizedExpression(parent); parent = ast.parent(parent))
    value = parent;
  const owner = ast.parent(value);
  if (owner === undefined) return undefined;
  // An object-literal accessor is stored in its record's accessor slot, a callable with the program error
  // (rustStructuralPropertyGetterStorageCarrier / rustStructuralPropertySetterStorageCarrier).
  if ((ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node)) && ast.is.IsObjectLiteralExpression(owner))
    return rustProgramErrorTargetType();
  const operation = program.records.targetOperation.get(owner);
  let slot: TargetTypeRef | undefined;
  if (operation?.kind === "provider-operation" && (ast.is.IsCallExpression(owner) || ast.is.IsNewExpression(owner))) {
    const index = ast.arguments(owner).indexOf(value);
    slot = index < 0 ? undefined
      : operation.abi.sourceArguments.find(argument => argument.sourceIndex === index && argument.form === "value")?.carrier;
  } else if (operation?.kind === "source-call" && (ast.is.IsCallExpression(owner) || ast.is.IsNewExpression(owner))) {
    const index = ast.arguments(owner).indexOf(value);
    const parameterIndex = operation.parameters.findIndex(parameter => parameter.inputs.some(input =>
      input.sourceArgumentIndex === index && input.sourceForm === "value"));
    const declaration = asSourceNode(program.records.selectedCall.get(owner)?.sourceDeclaration, ast);
    const parameter = declaration === undefined || parameterIndex < 0 ? undefined
      : program.records.callableDeclaration.get(declaration)?.contract.nativeParameters[parameterIndex]?.sourceParameter;
    if (parameter !== undefined && program.callableValues.native.isConcreteCallableParameter(parameter))
      slot = operation.parameters[parameterIndex]?.parameterCarrier;
  } else if (operation?.kind === "array-literal" && ast.is.IsArrayLiteralExpression(owner)) {
    const selected = program.callableValues.nativeStorage.valueFor(owner);
    if (selected.kind === "unresolved")
      failTargetAnalysisInvariant("tsonic-rust", "A callable array element requires its selected physical aggregate storage.", owner);
    const element = selected.carrier.kind === "array" || selected.carrier.kind === "slice" ? selected.carrier.element
      : rustJsArrayLikeElementTargetType(selected.carrier);
    return element === undefined ? undefined : rustCallablePhysicalSignature(rustOptionElementCarrier(element) ?? element)?.error;
  }
  else if (ast.is.IsPropertyDeclaration(owner)) {
    slot = program.callableValues.projectFieldStorage.get(owner);
  } else if (ast.is.IsBinaryExpression(owner) && BinaryExpression_Right(ast, owner) === value) {
    const left = BinaryExpression_Left(ast, owner);
    const target = left === undefined ? undefined : program.records.targetOperation.get(left);
    if (target?.kind === "source-method-property" && target.write !== undefined) slot = target.callableCarrier;
    else if (target?.kind === "source-field" && target.declaration !== undefined && target.valueSemantics.kind === "stored")
      slot = program.callableValues.projectFieldStorage.get(target.declaration);
  }
  const erased = slot === undefined ? undefined : rustOptionElementCarrier(slot) ?? slot;
  return erased?.kind === "target-named" && erased.id === rustCallableTargetId ? rustCallableProtocol(erased)?.error : undefined;
}
