import assert from "node:assert/strict";
import test from "node:test";
import { jsonNativeProjectionSource } from "../../../../../tsonic/test/fixtures/json-native-projection.mjs";
import { analyzeRust, acmeVectorsPackage } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { applyFinalizedRustArgumentMode, createRustSharedReferenceArgument,
  createRustMutableReferenceArgument } from "../../../../dist/backend/planner/expressions/input-shaping.js";

function sourceNodes(program) {
  const result = [];
  const visit = node => {
    result.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().forEach(artifact => visit(artifact.sourceFile));
  return result;
}

test("a converted JSON reference borrows the selected value, never the original structural source", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": jsonNativeProjectionSource } });
  const inputs = sourceNodes(program).flatMap(node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "provider-operation" || !operation.operationId.startsWith("tsonic.rust.js.JSON.stringify.")) return [];
    const occurrence = program.records.providerSourceOccurrence.get(node, operation);
    assert.equal(occurrence !== undefined, true, "the real JSON call has one sealed source occurrence");
    return occurrence.inputs.filter(({ input }) => input.source.kind === "argument" && input.source.sourceIndex === 0);
  });
  assert.equal(inputs.length, 3, "root, nested and throwing projection use the same owner");
  for (const { input, slot } of inputs) {
    assert.equal(input.mode, "ref", "the actual JSON ABI borrows its converted value");
    assert.equal(input.conversion.kind === "identity", false, "the real structural source requires conversion");
    const context = rustSourceFilePlanContext(program, slot.node);
    const converted = { kind: "call", path: "selected_finalized_value", args: [] };
    for (const stabilized of [false, true]) {
      const value = applyFinalizedRustArgumentMode(context, slot.node, converted, input, false, stabilized);
      assert.equal(value.kind === "reference" && value.expr === converted && value.mutable !== true, true,
        `${stabilized ? "stabilized" : "direct"}: the exact converted value is borrowed without source reevaluation`);
    }
  }
});

test("stabilized native inputs preserve their exact shared, exclusive and by-value ABI", () => {
  const { program } = analyzeRust({ packages: [acmeVectorsPackage()], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { Vector, magnitude, scale } from "@acme/vectors";
    export function read(value: Vector): int32 { return magnitude(value); }
    export function update(value: Vector, factor: int32): void { scale(value, factor); }
  ` } });
  const inputs = sourceNodes(program).flatMap(node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "provider-operation" || !program.source.ast.is.IsCallExpression(node)) return [];
    const occurrence = program.records.providerSourceOccurrence.get(node, operation);
    assert.equal(occurrence !== undefined, true, "native call inputs come from the sealed source occurrence");
    return occurrence.inputs;
  });
  assert.equal(inputs.length, 3, "one read input plus the mutation's two actual inputs");
  assert.deepEqual(inputs.map(({ input }) => input.mode).sort(), ["mut-ref", "ref", "value"]);
  for (const { input, slot } of inputs) {
    assert.equal(input.conversion.kind, "identity", "the inverse control has no semantic carrier conversion");
    const context = rustSourceFilePlanContext(program, slot.node);
    const bound = { kind: "path", path: "selected_stabilized_input" };
    const value = applyFinalizedRustArgumentMode(context, slot.node, bound, input, false, true);
    if (input.mode === "value") assert.equal(value === bound, true, "a by-value binding passes once unchanged");
    else assert.equal(value.kind === "reference" && value.expr === bound && (value.mutable === true) === (input.mode === "mut-ref"), true,
      `${input.mode}: the bound value, not the original place or parameter ABI, determines reference syntax`);
  }
  const borrowed = inputs.find(({ input, slot }) => input.mode === "ref" && program.records.providerReference.get(slot.node, input));
  assert.equal(borrowed !== undefined, true, "the real unchanged reference parameter retains its pass-through evidence");
  const reference = { kind: "reference", expr: { kind: "path", path: "actual_reference_parameter" } };
  const context = rustSourceFilePlanContext(program, borrowed.slot.node);
  assert.equal(applyFinalizedRustArgumentMode(context, borrowed.slot.node, reference, borrowed.input, true) === reference, true,
    "a non-stabilized native reference retains identity without an extra borrow");
});

test("projected reference values never recover an unprojected source view", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function text(value: string | number): string {
      if (typeof value === "string") return value;
      return "";
    }
  ` } });
  const projected = sourceNodes(program).filter(node => {
    const selected = program.records.valueProjection.get(node);
    return selected !== undefined && (selected.flow !== undefined || selected.upcast !== undefined || selected.downcast !== undefined ||
      selected.object !== undefined || selected.contextual !== undefined && !selected.contextualIdentity || selected.option !== undefined);
  });
  assert.equal(projected.length > 0, true, "the checked narrowing publishes an actual value projection");
  for (const node of projected) {
    const context = rustSourceFilePlanContext(program, node);
    const value = { kind: "call", path: "already_projected_value", args: [] };
    const shared = createRustSharedReferenceArgument(context, value, node);
    assert.equal(shared.kind === "reference" && shared.expr === value && shared.mutable !== true, true,
      "shared shaping preserves the projection and its single evaluation");
    const exclusive = createRustMutableReferenceArgument(context, value, node);
    assert.equal(exclusive.kind === "reference" && exclusive.expr === value && exclusive.mutable === true, true,
      "exclusive shaping preserves the same selected value rather than a source slice");
  }
});

test("missing sealed provider-reference correspondence still fails closed", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": jsonNativeProjectionSource } });
  const node = sourceNodes(program).find(node => program.records.targetOperation.get(node)?.kind === "provider-operation" &&
    program.records.targetOperation.get(node).operationId.startsWith("tsonic.rust.js.JSON.stringify."));
  assert.equal(node !== undefined, true, "the refusal control uses an actual admitted JSON operation");
  const operation = program.records.targetOperation.get(node);
  const selected = program.records.providerSourceOccurrence.get(node, operation).inputs.find(({ input }) =>
    input.source.kind === "argument" && input.source.sourceIndex === 0);
  assert.equal(selected !== undefined, true, "the real conversion input exists before its record is corrupted");
  const records = createRustRecordFixture({ providerReference: { get: () => undefined } }, program.records);
  const context = rustSourceFilePlanContext({ ...program, records }, selected.slot.node);
  assert.throws(() => applyFinalizedRustArgumentMode(context, selected.slot.node,
    { kind: "path", path: "converted_value" }, selected.input, false),
  error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
    error.message === "An admitted provider reference requires its exact source parameter and reborrow contract.",
  "missing correspondence is not reconstructed from a source name or carrier");
});
