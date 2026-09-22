import { rustGenericCallableProtocol } from "../../../../target-model/types/carriers/generic-callables.js";
import { rustSuspendedCallableInvocationResult } from "../../../../analysis/facts/callable-results.js";
import {
  isRustCopyCarrier,
  isRustVecCarrier,
  rustCallableProtocol,
  rustNativeCallableProtocol,
  rustFixedArrayCarrierValue,
  rustSliceElementCarrier,
  rustTargetGenericBindingsForArguments,
  substituteRustTargetGenerics,
} from "../../../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../../../target-model/types/carriers/substitution.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { isDenseDataArray } from "../../../../target-model/metadata/closed-data.js";
import {
  KindSpreadElement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import {
  createRustMutableReferenceArgument,
  planRustCallArguments,
} from "../input-shaping.js";
import { planExpression } from "../entry.js";
import { planRustNonConsumingValue } from "../typed-locations.js";
import { rustArgumentPassingMode } from "../../../../analysis/facts/parameter-passing.js";
import { rustFinalizedCarrierTransitionMatches } from "../../../../analysis/facts/target-operation.js";
import {
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
} from "../../../../analysis/facts/keys.js";
import {
  rustTargetGenericArgumentEquals,
  rustTargetTypeRefEquals,
} from "../../../../target-model/types/equality.js";
import { rustValueCarrierTransitionTarget } from "../../../../analysis/facts/value-carrier-queries.js";
import { rustSpreadElementCarrier } from "../../../../target-model/operations/rest-assembly.js";
import { planRustRestAssembly } from "./rest-assembly.js";
import { validateRustFinalizedOperationAbi } from "../../../../analysis/facts/finalized-operation-abi.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustSelectedTargetSignature as SelectedTargetSignatureFact, TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";

export function shapeRustSourceCallParameters(
  argumentNodes: readonly Node[],
  arguments_: readonly RustExpr[],
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const shaped: RustExpr[] = [];
  for (const [parameterIndex, parameter] of fact.parameters.entries()) {
    if (parameter.form === "rest") {
      if (parameter.mode !== "value") {
        return undefined;
      }
      const sequenceInputs = parameter.inputs.filter((input) =>
        input.sourceForm === "spread-sequence");
      if (sequenceInputs.length > 0) {
        const composed = shapeRustRestSequenceInputs(
          parameterIndex,
          parameter,
          argumentNodes,
          arguments_,
          context,
        );
        if (composed === undefined) {
          return undefined;
        }
        shaped.push(composed);
        continue;
      }
      const elements: RustExpr[] = [];
      for (const input of parameter.inputs) {
        const element = shapeRustSourceCallInput(
          parameterIndex,
          parameter,
          input,
          argumentNodes,
          arguments_,
          context,
        );
        if (element === undefined) {
          return undefined;
        }
        elements.push(element);
      }
      shaped.push({ kind: "vec-literal", elements });
      continue;
    }
    const input = parameter.inputs[0];
    if (input === undefined) {
      if (parameter.form !== "optional" && parameter.form !== "default") {
        return undefined;
      }
      shaped.push({ kind: "none" });
      continue;
    }
    if (parameter.inputs.length !== 1) {
      return undefined;
    }
    const value = shapeRustSourceCallInput(
      parameterIndex,
      parameter,
      input,
      argumentNodes,
      arguments_,
      context,
    );
    if (value === undefined) {
      return undefined;
    }
    shaped.push(value);
  }
  return shaped;
}

function shapeRustRestSequenceInputs(
  parameterIndex: number,
  parameter: import("../../../../analysis/facts/keys.js").RustSourceCallParameterPlan,
  argumentNodes: readonly Node[],
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  if (parameter.inputs.length === 1) {
    return shapeRustSourceCallInput(
      parameterIndex,
      parameter,
      parameter.inputs[0]!,
      argumentNodes,
      arguments_,
      context,
    );
  }
  const segments: { readonly value: RustExpr; readonly sequence: boolean }[] = [];
  for (const input of parameter.inputs) {
    const value = shapeRustSourceCallInput(
      parameterIndex,
      parameter,
      input,
      argumentNodes,
      arguments_,
      context,
    );
    if (value === undefined) {
      return undefined;
    }
    segments.push({ value, sequence: input.sourceForm === "spread-sequence" });
  }
  return planRustRestAssembly(segments, context);
}

export function planRustSourceCallArgumentEvaluation(
  call: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): {
  readonly arguments: readonly RustExpr[];
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
} | undefined {
  const rawArguments = context.input.program.source.ast.arguments(call);
  if (!isDenseDataArray(rawArguments) || rawArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-arguments",
      "Selected project-source call contains an undefined or non-data argument slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArguments as readonly Node[];
  const hasSpread = fact.parameters.some((parameter) =>
    parameter.inputs.some((input) => input.sourceForm !== "value"));
  const planned = argumentNodes.map((argument) => {
    const source = context.input.program.source.ast.kindName(argument) === KindSpreadElement
      ? Node_Expression(context.input.program.source.ast, argument)
      : argument;
    return source === undefined ? undefined : planExpression(source, context);
  });
  if (planned.some((argument) => argument === undefined)) {
    return undefined;
  }
  if (!hasSpread) {
    return {
      arguments: planned as readonly RustExpr[],
      bindings: [],
    };
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-spread-names",
      "Project-source spread evaluation requires one finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const bindings = (planned as readonly RustExpr[]).map((value) => ({
    name: allocateRustSyntheticName(context.syntheticNames!, "spread_argument"),
    value,
  }));
  return {
    arguments: bindings.map((binding) => ({ kind: "path", path: binding.name })),
    bindings,
  };
}

export function planRustSelectedSourceCallArguments(
  call: Node,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const fact = context.input.program.facts.getFact(call, rustTargetOperationFactKey);
  const selected = context.input.program.facts.getSelectedTargetCall(call);
  if (fact?.kind !== "source-call" || selected === undefined ||
    !sourceCallSelectedMemberMatches(
      fact,
      selected,
      sourceCallFinalizedResultCarrier(selected, context),
      context.input.program.typeFamilies.normalize,
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-selected-arguments",
      "Project-source call arguments require one exact selected target call and finalized Rust ABI.",
    ));
    return undefined;
  }
  const rawArguments = context.input.program.source.ast.arguments(call);
  if (!isDenseDataArray(rawArguments) || rawArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-selected-arguments",
      "Project-source call arguments contain an undefined or non-data slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArguments as readonly Node[];
  const arguments_ = planRustCallArguments(call, context);
  return arguments_ === undefined
    ? undefined
    : shapeRustSourceCallParameters(
        argumentNodes,
        arguments_,
        fact,
        context,
      );
}

function shapeRustSourceCallInput(
  parameterIndex: number,
  parameter: import("../../../../analysis/facts/keys.js").RustSourceCallParameterPlan,
  input: import("../../../../analysis/facts/keys.js").RustSourceCallParameterPlan["inputs"][number],
  argumentNodes: readonly Node[],
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  const argumentNode = argumentNodes[input.sourceArgumentIndex];
  const argument = arguments_[input.sourceArgumentIndex];
  if (argumentNode === undefined || argument === undefined) {
    return undefined;
  }
  const passing = context.input.program.facts.getArgumentPassingFact(argumentNode);
  const expectedPassing = rustArgumentPassingMode(parameter.mode);
  if (passing?.mode !== expectedPassing) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, argumentNode),
      "rust.backend.source-call-parameter-passing",
      `Project-source parameter ${parameterIndex} requires finalized passing mode '${expectedPassing}'.`,
    ));
    return undefined;
  }
  const sourceCarrier = context.input.program.facts.getRuntimeCarrierFact(argumentNode)?.carrier;
  const convertedCarrier = rustValueCarrierTransitionTarget(
    context.input.program.facts,
    argumentNode,
  );
  const selectedInput = resolveFinalizedRustSpreadInput(
    input,
    sourceCarrier,
    convertedCarrier,
    argument,
    context,
  );
  if (selectedInput === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, argumentNode),
      "rust.backend.source-call-argument-carrier",
      `Project-source argument ${input.sourceArgumentIndex} conflicts with parameter ${parameterIndex}'s exact selected carrier.`,
    ));
    return undefined;
  }
  if (parameter.mode === "value") {
    return selectedInput;
  }
  if (parameter.parameterCarrier.kind !== "reference" ||
    !rustTargetTypeRefEquals(parameter.parameterCarrier.referent, input.carrier) &&
    !(isRustVecCarrier(input.carrier) &&
      rustTargetTypeRefEquals(
        rustSliceElementCarrier(parameter.parameterCarrier),
        input.carrier.element,
      ))) {
    return undefined;
  }
  const mutable = parameter.mode === "mut-ref";
  const sourceParameterAbi = context.input.program.facts.getFact(argumentNode, rustSourceParameterAbiFactKey);
  const nonConsumingInput = planRustNonConsumingValue(argumentNode, selectedInput, context);
  return sourceParameterAbi?.mode === parameter.mode &&
      rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, parameter.parameterCarrier)
    ? nonConsumingInput
    : nonConsumingInput.kind === "string-literal" && !mutable
      ? { kind: "str-literal", value: nonConsumingInput.value }
      : mutable
        ? createRustMutableReferenceArgument(nonConsumingInput)
        : { kind: "reference", expr: nonConsumingInput };
}

function resolveFinalizedRustSpreadInput(
  input: import("../../../../analysis/facts/keys.js").RustSourceCallParameterPlan["inputs"][number],
  sourceCarrier: TargetTypeRef | undefined,
  convertedCarrier: TargetTypeRef | undefined,
  sourceExpression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  if (sourceCarrier === undefined) {
    return undefined;
  }
  if (input.sourceForm === "value" || input.sourceForm === "spread-sequence") {
    const normalize = context.input.program.typeFamilies.normalize;
    return rustFinalizedCarrierTransitionMatches(
      mapRustTargetTypes(sourceCarrier, normalize),
      convertedCarrier === undefined ? undefined : mapRustTargetTypes(convertedCarrier, normalize),
      mapRustTargetTypes(input.carrier, normalize),
    ) || convertedCarrier === undefined &&
      context.input.program.structuralShapes.sharesStorage(sourceCarrier, input.carrier)
      ? sourceExpression
      : undefined;
  }
  if (convertedCarrier !== undefined || input.spreadElementIndex === undefined) {
    return undefined;
  }
  const element = rustSpreadElementCarrier(
    sourceCarrier,
    input.spreadElementIndex,
  );
  if (element === undefined || !rustTargetTypeRefEquals(
    mapRustTargetTypes(element, context.input.program.typeFamilies.normalize),
    mapRustTargetTypes(input.carrier, context.input.program.typeFamilies.normalize),
  )) {
    return undefined;
  }
  const fixedArray = rustFixedArrayCarrierValue(sourceCarrier);
  const selected: RustExpr = fixedArray === undefined
    ? {
        kind: "field",
        receiver: sourceExpression,
        name: String(input.spreadElementIndex),
      }
    : {
        kind: "index",
        receiver: sourceExpression,
        index: { kind: "int-literal", text: String(input.spreadElementIndex) },
      };
  return fixedArray !== undefined && !isRustCopyCarrier(element)
    ? { kind: "method-call", receiver: selected, method: "clone", args: [] }
    : selected;
}

export function planPromotedSourceMethodCall(
  node: Node,
  location: RustExpr,
  method: string,
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr {
  const syntheticNames = context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const locationName = allocateRustSyntheticName(syntheticNames, "location");
  const ownerName = allocateRustSyntheticName(syntheticNames, "location_value");
  const argumentBindings = arguments_.map((value, index) => ({
    name: allocateRustSyntheticName(syntheticNames, `location_argument_${index}`),
    value,
  }));
  const locationReceiver: RustExpr = arguments_.length === 0
    ? location
    : { kind: "path", path: locationName };
  const call: RustExpr = {
    kind: "method-call",
    receiver: { kind: "path", path: ownerName },
    method,
    args: argumentBindings.map((binding) => ({
      kind: "path",
      path: binding.name,
    })),
  };
  const mutation: RustExpr = {
    kind: "method-call",
    receiver: locationReceiver,
    method: "with_mut",
    args: [{
      kind: "closure",
      params: [{ name: ownerName, byRefCopy: false }],
      body: call,
    }],
  };
  return arguments_.length === 0
    ? mutation
    : {
        kind: "block",
        bindings: [{ name: locationName, value: location }, ...argumentBindings],
        value: mutation,
      };
}

export function sourceCallSelectedMemberMatches(
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  selected: SelectedTargetSignatureFact,
  declaredResultCarrier: TargetTypeRef | undefined,
  normalize: (carrier: TargetTypeRef) => TargetTypeRef,
): boolean {
  const member = selected.member;
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const parameters = member.genericParameters ?? [];
  const targetArguments = fact.targetGenericArguments ?? [];
  const selectedArguments = selected.targetGenericArguments ?? [];
  if (sourceArguments.length !== parameters.length ||
    parameters.length !== targetArguments.length ||
    selectedArguments.length !== targetArguments.length ||
    parameters.some((parameter, index) =>
      parameter.sourceName !== sourceArguments[index]?.typeParameterName) ||
    selectedArguments.some((argument, index) => {
      const parameter = parameters[index];
      const sourceArgument = sourceArguments[index];
      const targetArgument = targetArguments[index];
      const targetFinalizesInferredType = parameter?.kind === "type" &&
        sourceArgument?.explicitTypeNode === undefined &&
        argument.kind === "type" && targetArgument?.kind === "type";
      return !targetFinalizesInferredType &&
        !rustTargetGenericArgumentEquals(argument, targetArgument);
    })) {
    return false;
  }
  const substitutions = rustTargetGenericBindingsForArguments(parameters, targetArguments);
  if (substitutions === undefined) return false;
  const expectedKind = fact.target.form === "constructor" ? "constructor" : "method";
  const expectedTargetName = fact.target.form === "constructor"
    ? fact.target.name
    : fact.target.form === "callable" || fact.target.form === "structural-method" || fact.target.form === "constructor-value"
      ? member.targetName
      : fact.target.form === "function"
        ? fact.target.selectedTargetName
        : fact.target.form === "union-method"
          ? fact.target.variants.find(variant => variant.declaration === selected.sourceDeclaration)?.targetName
          : fact.target.name;
  const selectedReturn = declaredResultCarrier === undefined
    ? undefined
    : substituteRustTargetGenerics(
        declaredResultCarrier,
        substitutions.types,
        substitutions.lifetimes,
        substitutions.consts,
        normalize,
      );
  const identityMatches = member.id === fact.operationId &&
    member.kind === expectedKind &&
    member.targetName === expectedTargetName &&
    selectedReturn !== undefined && rustTargetTypeRefEquals(selectedReturn, mapRustTargetTypes(fact.resultCarrier, normalize));
  if (!identityMatches) {
    return false;
  }
  const callableCarrier = fact.target.form === "callable" ? fact.target.carrier
    : fact.target.form === "structural-method" || fact.target.form === "constructor-value" ? fact.target.callableCarrier : undefined;
  const genericNames = parameters.flatMap(parameter => parameter.kind === "type" ? [parameter.sourceName] : []);
  const callable = rustGenericCallableProtocol(callableCarrier, genericNames) ??
    rustNativeCallableProtocol(callableCarrier) ?? rustCallableProtocol(callableCarrier);
  if (callable !== undefined) {
    return callable.parameters.length === fact.parameters.length &&
      callable.parameters.every((carrier, index) => {
        carrier = substituteRustTargetGenerics(carrier, substitutions.types,
          substitutions.lifetimes, substitutions.consts, normalize);
        const parameter = fact.parameters[index];
        if (parameter === undefined || !rustTargetTypeRefEquals(carrier, mapRustTargetTypes(parameter.parameterCarrier, normalize))) return false;
        if (parameter.mode === "value") return true;
        const valueCarrier = mapRustTargetTypes(parameter.valueCarrier, normalize);
        return callableCarrier?.kind === "closure" && carrier.kind === "reference" &&
          parameter.mode === (carrier.mutable ? "mut-ref" : "ref") &&
          (rustTargetTypeRefEquals(carrier.referent, valueCarrier) ||
            valueCarrier.kind === "array" &&
            rustTargetTypeRefEquals(rustSliceElementCarrier(carrier), valueCarrier.element));
      });
  }
  return isDenseDataArray(member.parameters) && member.parameters.length === fact.parameters.length &&
    member.parameters.every((parameter, index) => {
      const factParameter = fact.parameters[index];
      if (factParameter === undefined) return false;
      const mode = parameter.passingMode === "borrow-mut"
        ? "mut-ref"
        : parameter.passingMode === "borrow-shared"
          ? "ref"
          : "value";
      return rustTargetTypeRefEquals(
        substituteRustTargetGenerics(
          parameter.type,
          substitutions.types,
          substitutions.lifetimes,
          substitutions.consts,
          normalize,
        ),
        mapRustTargetTypes(factParameter.parameterCarrier, normalize),
      ) && mode === factParameter.mode;
    });
}

export function sourceCallFinalizedResultCarrier(
  selected: SelectedTargetSignatureFact,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  return rustSuspendedCallableInvocationResult(context.input.program.facts, selected.sourceDeclaration) ?? selected.member.returnType;
}

export function requireProviderArgumentPassingFacts(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  arguments_: readonly (Node | undefined)[],
): boolean {
  if (!validateRustFinalizedOperationAbi(fact.abi, context.input.program.typeDefinitions) || arguments_.length !== fact.abi.sourceArguments.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, arguments_.find((candidate): candidate is Node => candidate !== undefined) ?? context.sourceFile),
      "rust.backend.provider-argument-abi",
      "Provider arguments require one valid total Rust operation ABI with exact source arity.",
    ));
    return false;
  }
  let valid = true;
  const requiresSelectedParameterPassingFact = fact.abi.operationKind === "method" ||
    fact.abi.operationKind === "constructor";
  for (const sourceArgument of fact.abi.sourceArguments) {
    const index = sourceArgument.sourceIndex;
    const argument = arguments_[index];
    if (argument === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, arguments_.find((candidate): candidate is Node => candidate !== undefined) ?? context.sourceFile),
        "rust.backend.provider-argument",
        `Provider operation selects missing source argument ${index}.`,
      ));
      valid = false;
      continue;
    }
    if (sourceArgument.disposition === "compile-time") {
      continue;
    }
    if (requiresSelectedParameterPassingFact) {
      const expected = rustArgumentPassingMode(sourceArgument.mode);
      const actual = context.input.program.facts.getArgumentPassingFact(argument);
      if (actual === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, argument),
          "rust.backend.parameter-passing",
          `Provider argument ${index} requires finalized Rust parameter-passing mode '${expected}'.`,
        ));
        valid = false;
        continue;
      }
      if (actual.mode !== expected) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, argument),
          "rust.backend.parameter-passing",
          `Provider argument ${index} has finalized parameter-passing mode '${actual.mode}', expected '${expected}'.`,
        ));
        valid = false;
      }
    }
  }
  return valid;
}
