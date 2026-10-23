import assert from "node:assert/strict";
import test from "node:test";
import { Node_Initializer } from "@tsonic/target-api/source";
import { jsonNativeProjectionSource } from "../../../../../tsonic/test/fixtures/json-native-projection.mjs";
import { analyzeRust, acmeVectorsPackage } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { applyFinalizedRustArgumentMode, applyRustArgumentMode, createRustSharedReferenceArgument,
  createRustMutableReferenceArgument } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";

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
  const shared = inputs.filter(({ input }) => input.mode === "ref");
  assert.equal(shared.length, 1, "the native Vector reader has one actual shared input");
  assert.equal(program.records.sourceParameterAbi.get(shared[0].slot.node)?.mode, "value",
    "a native provider's reference input does not invent a borrowed source parameter ABI");
  assert.equal(program.records.providerReference.get(shared[0].slot.node, shared[0].input), false,
    "the owned Vector source must be borrowed rather than falsely reused as an existing reference");
});

test("an actual readonly String parameter preserves its admitted non-stabilized reference", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function read(value: string): number { return value.indexOf("x"); }
    console.log(read("x"));
  ` } });
  const inputs = program.physicalEmissionContexts.sourceOccurrences
    .filter(occurrence => occurrence.operation.abi.operationKind === "method")
    .flatMap(occurrence => occurrence.inputs)
    .filter(({ input }) => input.source.kind === "receiver");
  assert.equal(inputs.length, 1, "one actual checked readonly String receiver supplies the inverse");
  const borrowed = inputs[0];
  assert.equal(borrowed.input.mode, "ref", "the provider accepts the exact native shared String input");
  assert.equal(borrowed.input.conversion.kind, "identity", "no conversion replaces the original borrowed String");
  assert.equal(program.records.sourceParameterAbi.get(borrowed.slot.node)?.mode, "ref",
    "the real source parameter has the native reference ABI before planning");
  assert.equal(program.records.providerReference.get(borrowed.slot.node, borrowed.input), true,
    "the canonical producer admits unchanged native reference pass-through");
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
    const shared = createRustSharedReferenceArgument(context, { stage: "source", expression: value, node });
    assert.equal(shared.kind === "reference" && shared.expr === value && shared.mutable !== true, true,
      "shared shaping preserves the projection and its single evaluation");
    const exclusive = createRustMutableReferenceArgument(context, { stage: "source", expression: value, node });
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

test("operator-specific conversions survive reference shaping independently of node projections", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function smaller(left: bigint, right: number | bigint): boolean {
      return left < right && left < right;
    }
  ` } });
  const comparisons = sourceNodes(program).filter(node => {
    const selected = program.records.binaryEmission.get(node);
    return selected?.fact.kind === "operator-call" && selected.fact.leftConversion?.kind === "semantic-conversion" &&
      selected.fact.leftConversion.id === "js-numeric-from-bigint";
  });
  assert.equal(comparisons.length, 2, "both repeated reads use the real selected BigInt-to-JsNumeric operation");
  for (const node of comparisons) {
    const selected = program.records.binaryEmission.get(node);
    const context = rustSourceFilePlanContext(program, node);
    const expression = planBinaryExpression(node, context);
    assert.equal(expression !== undefined, true, "the selected operator produces one native expression");
    const printed = printRustExpr(expression);
    assert.equal((printed.match(/JsNumeric::from_bigint/gu) ?? []).length, 1,
      "the selected conversion is retained once, rather than replaced by the original BigInt storage");
    assert.match(printed, /JsNumeric::less_than\(&js_abi::JsNumeric::from_bigint\(/u,
      "the operator borrows its finalized JsNumeric, not the preconversion input");
    assert.equal(program.records.argumentView.get(selected.left)?.borrowedStorage !== undefined, true,
      "the inverse source-storage path really exists, so node identity alone cannot justify replanning");
    const finalized = { kind: "call", path: "selected_conversion_with_effect", args: [] };
    const argument = applyRustArgumentMode(context, { stage: "finalized", expression: finalized }, "ref");
    assert.equal(argument.kind === "reference" && argument.expr === finalized, true,
      "a finalized value preserves both conversion and its single effectful evaluation");
  }
});

test("finalized argument stages never consult original source storage or parameter ABI", () => {
  const value = { kind: "call", path: "one_effect", args: [] };
  const context = { get input() { throw new Error("finalized shaping must not recover original-node evidence"); } };
  for (const mode of ["value", "ref", "mut-ref"]) {
    const planned = applyRustArgumentMode(context, { stage: "finalized", expression: value }, mode);
    assert.equal(mode === "value" ? planned === value : planned.kind === "reference" && planned.expr === value &&
      (planned.mutable === true) === (mode === "mut-ref"), true, `${mode}: exactly the selected expression survives`);
  }
});

test("transparent shared inputs retain the source-selected capture guard without cloning", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function make(seed: string): (next: string) => number {
      return (next: string): number => {
        seed = next;
        return Number.parseInt(seed) + Number.parseInt((seed)) + Number.parseInt(((seed))) +
          Number.parseInt(seed as string) + Number.parseInt(seed satisfies string) + Number.parseInt(seed!);
      };
    }
    export function ordinary(value: string): number { return Number.parseInt((value)); }
  ` } });
  const calls = sourceNodes(program).filter(node => {
    const operation = program.records.targetOperation.get(node);
    return operation?.kind === "provider-operation" && operation.abi.target.form === "call" &&
      operation.abi.target.path === "js_abi::number_parse_int";
  });
  assert.equal(calls.length, 7, "six actual capture views plus the ordinary native parameter inverse");
  let guarded = 0;
  for (const node of calls) {
    const argument = program.source.ast.arguments(node)[0];
    const view = program.records.argumentView.get(argument);
    const expression = planExpression(node, rustSourceFilePlanContext(program, node));
    assert.equal(expression !== undefined, true, "the selected native input is rendered");
    const printed = printRustExpr(expression);
    assert.doesNotMatch(printed, /\.clone\(/u, "borrow selection precedes native rendering, not clone-then-strip");
    if (view.borrowedStorage === "borrow-guard") {
      guarded += 1;
      assert.match(printed, /AsRef::<str>::as_ref\(&\*/u, "transparent views keep the exact guard payload reference");
      assert.equal((printed.match(/\.borrow\(\)/gu) ?? []).length, 1, "the selected guard is acquired once");
    } else {
      assert.doesNotMatch(printed, /\.borrow\(|&\*/u, "an ordinary native reference is not turned into a guard");
    }
  }
  assert.equal(guarded, 6, "every identity wrapper retains the same physical source fact");
});

test("an owned snapshot before a captured write keeps its required selected clone", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function snapshots(seed: string): (next: string) => string {
      return (next: string): string => {
        const before = seed;
        seed = next;
        return before;
      };
    }
  ` } });
  const snapshots = sourceNodes(program).filter(node => program.source.ast.is.IsVariableDeclaration(node) &&
    program.source.ast.text(program.source.ast.name(node)) === "before");
  assert.equal(snapshots.length, 1, "the authored snapshot has one exact source declaration");
  const node = Node_Initializer(program.source.ast, snapshots[0]);
  assert.equal(node !== undefined, true, "the snapshot reads the captured string before replacement");
  const ownership = program.records.readOwnership.get(node);
  assert.equal(ownership?.source.kind, "clone", "the owning analysis selects an owned snapshot, not a borrow across mutation");
  const context = rustSourceFilePlanContext(program, node);
  const snapshot = planExpression(node, context);
  assert.equal(snapshot !== undefined, true, "the selected snapshot is rendered");
  assert.equal((printRustExpr(snapshot).match(/\.clone\(/gu) ?? []).length, 1,
    "the required source snapshot is taken exactly once");
  const reference = applyRustArgumentMode(context, { stage: "finalized", expression: snapshot }, "ref");
  assert.equal(reference.kind === "reference" && reference.expr === snapshot, true,
    "a later reference borrows the owned snapshot, never the mutated original capture");
});
