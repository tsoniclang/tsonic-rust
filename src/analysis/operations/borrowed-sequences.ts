import type { Node, SourceFile } from "@tsonic/tsts";
import { sourceSequenceInputChoice, sourceSequenceInputIsEmpty } from "@tsonic/target-api/source";
import type { RustBorrowedSequenceInput } from "../facts/operations/borrowed-sequences.js";
import type { RustFactWalk } from "../program/walk.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { createRustCarrierProbe } from "../expressions/carrier-probe.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";
import { selectRustRestSequenceConversion } from "../../policy/conversions/rest-sequence.js";

export function rustBorrowedSequenceElementCandidates(
  walk: RustFactWalk, expression: Node, sourceFile: SourceFile,
): readonly TargetTypeRef[] | undefined {
  const choice = sourceSequenceInputChoice(walk.context.ast, expression);
  if (choice === undefined) return undefined;
  const probe = createRustCarrierProbe(walk);
  const elements: TargetTypeRef[] = [];
  for (const input of choice.inputs) {
    if (sourceSequenceInputIsEmpty(walk.context.ast, input)) continue;
    const carrier = resolveExpressionCarrier(probe, input, sourceFile, undefined);
    const present = rustOptionElementCarrier(carrier) ?? carrier;
    const selected = present === undefined ? undefined : rustRestSequenceElements(present);
    if (selected === undefined) return undefined;
    elements.push(...selected.elements);
  }
  return Object.freeze(elements);
}

export function selectRustBorrowedSequenceInput(
  walk: RustFactWalk, expression: Node, sourceFile: SourceFile, elementTarget: TargetTypeRef,
): RustBorrowedSequenceInput | undefined {
  const choice = sourceSequenceInputChoice(walk.context.ast, expression);
  if (choice === undefined) return undefined;
  const inputs: RustBorrowedSequenceInput["inputs"][number][] = [];
  for (const node of choice.inputs) {
    if (sourceSequenceInputIsEmpty(walk.context.ast, node)) {
      inputs.push(Object.freeze({ kind: "empty", expression: node }));
      continue;
    }
    const carrier = resolveExpressionCarrier(walk, node, sourceFile, undefined);
    if (carrier === undefined) return undefined;
    const optional = rustOptionElementCarrier(carrier);
    const presentCarrier = optional ?? carrier;
    const conversion = selectRustRestSequenceConversion(presentCarrier, elementTarget, walk.context.typeDefinitions);
    if (conversion === undefined) return undefined;
    inputs.push(Object.freeze({ kind: "sequence", expression: node, carrier, presentCarrier,
      optional: optional !== undefined, conversion }));
  }
  return Object.freeze({ expression, controlNodes: choice.controlNodes, inputs: Object.freeze(inputs) });
}
