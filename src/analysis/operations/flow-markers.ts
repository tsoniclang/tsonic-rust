import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { flowStateFactKey } from "@tsonic/tsts";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { requireRustRecord } from "../program/records/required-records.js";
import { setCarrierFact } from "./project-calls.js";

interface FlowMarkerResolution {
  readonly carrier: TargetTypeRef | undefined;
}

export function tryFlowMarkerCall(
  walk: RustFactWalk,
  expression: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): FlowMarkerResolution | undefined {
  const flow = walk.context.source.sourceFacts.getFact(expression, flowStateFactKey);
  if (flow === undefined) {
    return undefined;
  }
  const [argument] = callArguments;
  const argumentCarrier = argument === undefined
    ? undefined
    : resolveExpressionCarrier(walk, argument, sourceFile, expected);
  if (flow.state !== "moved" && flow.state !== "borrowed-shared" && flow.state !== "borrowed-mut") {
    return { carrier: undefined };
  }
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "flow-marker", "analysis/declarations/types-and-bindings.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "flow-marker",
    operationId: `tsonic.rust.flow.${flow.state}`,
    state: flow.state,
  });
  if (argumentCarrier !== undefined) {
    setCarrierFact(walk, expression, argumentCarrier);
  }
  return { carrier: argumentCarrier };
}

export function validateFlowMarkerAgainstMode(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref" | "mut-ref",
): void {
  const flow = walk.context.source.sourceFacts.getFact(argument, flowStateFactKey);
  const markerState = flow?.state;
  if (markerState === undefined) {
    return;
  }
  const compatible =
    (markerState === "moved" && mode === "value") ||
    (markerState === "borrowed-shared" && mode === "ref") ||
    (markerState === "borrowed-mut" && mode === "mut-ref");
  if (!compatible) {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_MARKER_MISMATCH",
      `Flow marker state '${markerState}' does not match the finalized argument mode '${mode}' for this position.`,
      argument,
      ["target.capability=rust.source.flow-marker"],
    );
  }
}
