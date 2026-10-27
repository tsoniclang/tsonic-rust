import { KindSpreadElement } from "@tsonic/target-api/source";

import { appendRustDiagnostic } from "../program/walk.js";

import { recordBindingWrite } from "../ownership/source-writes.js";

import { validateFlowMarkerAgainstMode } from "./flow-markers.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { rustArgumentPassingMode } from "../../policy/ownership/argument-passing.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { reconcileRequiredCarrier } from "../conversions/contextual-values.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";

import type { RustArgumentMode, RustSourceCallArgumentProjection, RustSourceCallParameterPlan } from "../../target-model/operations/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import { requireRustRecord } from "../program/records/objects/required-records.js";

interface RustSelectedSourceCallArgument {
  readonly argument: Node;
  readonly mode: RustArgumentMode;
}

export type RustSourceCallParameterRequest = Omit<RustSourceCallParameterPlan, "inputs"> & {
  readonly inputs: readonly Omit<RustSourceCallParameterPlan["inputs"][number], "projection">[];
};

interface RustPreparedSourceCallArguments {
  readonly arguments: readonly RustSelectedSourceCallArgument[];
  readonly parameters: readonly RustSourceCallParameterPlan[];
}

export function prepareSelectedSourceCallArguments(
  walk: RustFactWalk,
  callArguments: readonly Node[],
  sourceFile: SourceFile,
  parameters: readonly RustSourceCallParameterRequest[],
  bindings: readonly NonNullable<RustSelectedTargetSignature["sourceArgumentBindings"]>[number][],
): RustPreparedSourceCallArguments | undefined {
  const { ast } = walk.context;
  const selected: RustSelectedSourceCallArgument[] = [];
  const projections = new Map<RustSourceCallParameterRequest["inputs"][number], RustSourceCallArgumentProjection>();
  for (const [index, argument] of callArguments.entries()) {
    const argumentBindings = bindings.filter((binding) =>
      binding.sourceArgumentIndex === index);
    if (argumentBindings.length === 0) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_BINDING_MISSING",
        `Selected source argument ${index} has no exact parameter binding.`,
        argument,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    const inputs = parameters.flatMap((parameter) =>
      parameter.inputs
        .filter((input) => input.sourceArgumentIndex === index));
    const bindingCarriers = inputs.map(input => input.carrier);
    const expected = ast.kindName(argument) === KindSpreadElement
      ? undefined
      : bindingCarriers.length > 0 && bindingCarriers.every((carrier) =>
          rustTargetTypeRefEquals(carrier, bindingCarriers[0]))
        ? bindingCarriers[0]
        : undefined;
    const resolvedArgumentCarrier = resolveExpressionCarrier(
      walk,
      argument,
      sourceFile,
      expected,
    );
    const spread = ast.kindName(argument) === KindSpreadElement;
    const selectedProjections = resolvedArgumentCarrier === undefined ? [] : inputs.map(input =>
      selectSourceCallArgumentProjection(resolvedArgumentCarrier, input, spread, walk.context.typeDefinitions));
    if (resolvedArgumentCarrier === undefined || spread && inputs.length === 0 ||
      selectedProjections.some(projection => projection === undefined)) {
      // An argument whose own selection was refused already reported that refusal; no second diagnostic follows it.
      if (!walk.rejectedExpressions.has(argument)) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_ARGUMENT_CARRIER_MISSING",
          `Selected source argument ${index} has no exact carrier matching its effective parameter bindings.`,
          argument,
          ["target.capability=rust.source-call.argument-carrier"],
        );
      }
      return undefined;
    }
    for (const [inputIndex, input] of inputs.entries()) projections.set(input, selectedProjections[inputIndex]!);
    // A callable argument (for example a Promise resolver) whose invocation signature is wider than the instantiated
    // callable parameter reaches it through the finalized callable adapter, decided here like any contextual conversion.
    if (expected !== undefined && rustCallableProtocol(expected) !== undefined &&
      walk.context.records.contextualValueConversion.get(argument) === undefined &&
      rustCallableProtocol(resolvedArgumentCarrier) !== undefined &&
      !rustTargetTypeRefEquals(expected, resolvedArgumentCarrier) &&
      !reconcileRequiredCarrier(walk, argument, resolvedArgumentCarrier, expected)) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_CARRIER_MISSING",
        `Selected source argument ${index} has no callable adaptation to its effective parameter contract.`,
        argument,
        ["target.capability=rust.source-call.argument-carrier"],
      );
      return undefined;
    }
    const modes = parameters
      .filter((parameter) => parameter.inputs.some((input) =>
        input.sourceArgumentIndex === index))
      .map((parameter) => parameter.mode);
    if (modes.length === 0 || modes.some((mode) => mode !== modes[0])) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_MODE_CONFLICT",
        `Selected source argument ${index} spans incompatible target parameter modes.`,
        argument,
        ["target.capability=rust.source-call.argument-modes"],
      );
      return undefined;
    }
    const mode = modes[0]!;
    selected.push(Object.freeze({ argument, mode }));
  }
  const prepared: RustSourceCallParameterPlan[] = [];
  for (const parameter of parameters) {
    const inputs: RustSourceCallParameterPlan["inputs"][number][] = [];
    for (const input of parameter.inputs) {
      const projection = projections.get(input);
      if (projection === undefined) {
        appendRustDiagnostic(walk, "RUST_SOURCE_CALL_BINDING_MISSING",
          "Selected source input has no exact checked argument projection.", sourceFile,
          ["target.capability=rust.source-call.argument-bindings"]);
        return undefined;
      }
      inputs.push(Object.freeze({ ...input, projection }));
    }
    prepared.push(Object.freeze({ ...parameter, inputs: Object.freeze(inputs) }));
  }
  return Object.freeze({ arguments: Object.freeze(selected), parameters: Object.freeze(prepared) });
}

export function recordSelectedSourceCallArguments(walk: RustFactWalk, selected: readonly RustSelectedSourceCallArgument[]): void {
  for (const { argument, mode } of selected) {
    const passingMode = rustArgumentPassingMode(mode);
    requireRustRecord(walk.context.requiredRecords, "argumentPassing", argument, passingMode, "analysis/operations/project-calls.ts");
    walk.context.records.argumentPassingPlans.pass(argument, passingMode);
    validateFlowMarkerAgainstMode(walk, argument, mode);
    if (mode === "mut-ref") {
      recordBindingWrite(walk, argument, "referent");
    }
  }
}

function selectSourceCallArgumentProjection(
  sourceCarrier: TargetTypeRef,
  input: RustSourceCallParameterRequest["inputs"][number],
  spread: boolean,
  definitions: RustTypeDefinitions,
): RustSourceCallArgumentProjection | undefined {
  if (!spread) return input.sourceForm === "value" ? Object.freeze({ kind: "direct" }) : undefined;
  if (input.sourceForm === "spread-sequence") return rustTargetTypeRefEquals(sourceCarrier, input.carrier)
    ? Object.freeze({ kind: "direct" }) : undefined;
  const element = input.sourceForm !== "spread-element" || input.spreadElementIndex === undefined
    ? undefined : rustSpreadElementCarrier(sourceCarrier, input.spreadElementIndex);
  if (element === undefined) return undefined;
  if (rustTargetTypeRefEquals(element, input.carrier)) return Object.freeze({ kind: "element", sourceCarrier: element, conversion: null });
  const conversion = selectRustSourceValueConversion(element, input.carrier, definitions);
  const contract = conversion === undefined ? undefined : rustValueConversionContract(conversion, definitions);
  return contract === undefined || contract.fallible ? undefined
    : Object.freeze({ kind: "element", sourceCarrier: element, conversion: snapshotClosedMetadata(contract) });
}
