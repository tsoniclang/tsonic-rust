import { KindSpreadElement } from "@tsonic/target-api/source";

import { appendRustDiagnostic } from "../program/walk.js";

import { recordBindingWrite } from "../ownership/source-writes.js";

import { validateFlowMarkerAgainstMode } from "./flow-markers.js";

import { resolveExpressionCarrier } from "../expressions/carriers.js";

import { rustArgumentPassingMode } from "../../policy/ownership/argument-passing.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/member-selections.js";

import type { RustArgumentMode } from "../../target-model/operations/model.js";

import { requireRustRecord } from "../program/records/required-records.js";

interface RustSelectedSourceCallArgument {
  readonly argument: Node;
  readonly mode: RustArgumentMode;
}

export function prepareSelectedSourceCallArguments(
  walk: RustFactWalk,
  callArguments: readonly Node[],
  sourceFile: SourceFile,
  parameters: readonly import("../../target-model/operations/model.js").RustSourceCallParameterPlan[],
  bindings: readonly NonNullable<RustSelectedTargetSignature["sourceArgumentBindings"]>[number][],
): readonly RustSelectedSourceCallArgument[] | undefined {
  const { ast } = walk.context;
  const selected: RustSelectedSourceCallArgument[] = [];
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
    const bindingCarriers = parameters.flatMap((parameter) =>
      parameter.inputs
        .filter((input) => input.sourceArgumentIndex === index)
        .map((input) => input.carrier));
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
    if (resolvedArgumentCarrier === undefined ||
      ast.kindName(argument) === KindSpreadElement &&
        !selectedSpreadArgumentMatches(
          resolvedArgumentCarrier,
          parameters.flatMap((parameter) => parameter.inputs.filter((input) =>
            input.sourceArgumentIndex === index)),
        )) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_CARRIER_MISSING",
        `Selected source argument ${index} has no exact carrier matching its effective parameter bindings.`,
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
  return Object.freeze(selected);
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

function selectedSpreadArgumentMatches(
  sourceCarrier: TargetTypeRef,
  inputs: readonly import("../../target-model/operations/model.js").RustSourceCallParameterPlan["inputs"][number][],
): boolean {
  return inputs.length > 0 && inputs.every((input) => {
    const selectedCarrier = input.sourceForm === "spread-element"
      ? input.spreadElementIndex === undefined
        ? undefined
        : rustSpreadElementCarrier(sourceCarrier, input.spreadElementIndex)
      : input.sourceForm === "spread-sequence"
        ? sourceCarrier
        : undefined;
    return selectedCarrier !== undefined &&
      rustTargetTypeRefEquals(selectedCarrier, input.carrier);
  });
}
