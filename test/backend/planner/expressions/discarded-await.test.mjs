import assert from "node:assert/strict";
import test from "node:test";
import { planRustAwaitBranches } from "../../../../dist/backend/planner/expressions/await-completions.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustFutureTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../../dist/target-model/types/index.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";
import { rustInfallibleTargetId } from "../../../../dist/target-model/types/carriers/source-types.js";
import { rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

function discardedFixture() {
  const node = fakeStatement({ kindName: "VoidExpression", pos: 0, end: 10 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "void value", statements: [node] });
  const ast = fakeAstReader([sourceFile]);
  const outputs = [rustSourcePrimitiveTargetType("uint64"), rustSourcePrimitiveTargetType("bool")];
  const selection = { kind: "union", carrier: rustSourceUnionTargetType("/src/index.ts", "Pending"),
    alternatives: outputs.map((output, index) => ({ variant: { kind: "payload", name: `Branch${index}` },
      selection: { kind: "leaf", value: { carrier: rustFutureTargetType(output), completion: { kind: "discard" },
        future: { outputCarrier: output, awaiting: "infallible", errorBoundary: "none",
          awaitedConversion: { kind: "identity", sourceCarrier: output, targetCarrier: output, fallible: false } } } } })) };
  const records = createRustRecordFixture({
    sourceTypeIdentity: { get: (fileName, name) => fileName === "/src/index.ts" && name === "Pending"
      ? { targetName: "Pending", native: true } : undefined },
    typeEmission: { get: () => ({ completion: "value", promiseObject: false }) },
  });
  const context = { input: { program: { source: { ast }, records } }, sourceFile, nativeHeaderPlacement: sourceFile, nativeHeaderParent: undefined,
    moduleName: "index", moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map(), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []), diagnostics: [] };
  return { node, context, selection, outputs };
}

test("discarded heterogeneous future completions need no success carrier join or conversion", () => {
  const { node, context, selection } = discardedFixture();
  const operand = { kind: "call", path: "select_once", args: [] };
  const planned = planRustAwaitBranches(node, operand, selection, undefined, context);
  assert.equal(planned?.kind, "match", "the finite operand selects its exact physical future");
  assert.equal(planned.expression === operand, true, "the original selection is evaluated once");
  assert.equal(planned.arms.length, 2, "both heterogeneous success carriers remain supported");
  for (const [index, arm] of planned.arms.entries()) {
    assert.equal(arm.pattern.path, `crate::index::Pending::Branch${index}`, "the sealed arm is preserved");
    assert.equal(arm.expression.kind, "evaluate-then", "the success is discarded after its effects");
    assert.equal(arm.expression.discard, "value", "discard does not require a unit-valued native result");
    assert.equal(arm.expression.effect.kind, "await", "the selected future is polled to completion");
    assert.equal(arm.expression.value.kind, "tuple-literal", "spawn's completion is native unit");
    assert.equal(arm.expression.value.elements.length, 0, "there is no synthetic success union");
  }
  assert.equal(context.diagnostics.length, 0, "discard emits no source diagnostic");
});

test("discard and valued await modes cannot silently substitute for each other", () => {
  const { node, context, selection, outputs } = discardedFixture();
  const leaf = selection.alternatives[0].selection;
  const operand = { kind: "path", path: "pending" };
  assert.throws(() => planRustAwaitBranches(node, operand, leaf, outputs[0], context),
    /discarded await cannot publish a valued completion/u, "a valued await cannot consume a discard-only selection");
  const valued = { ...leaf, value: { ...leaf.value, completion: { kind: "value",
    conversion: { kind: "identity", sourceCarrier: outputs[0], targetCarrier: outputs[0], fallible: false } } } };
  assert.throws(() => planRustAwaitBranches(node, operand, valued, undefined, context),
    /discarded await requires a sealed discard completion/u, "a discarded await cannot invent a success conversion");
});

test("a native Result with an uninhabited source error unwraps without inventing an active error channel", () => {
  const { node, context, selection } = discardedFixture();
  const original = selection.alternatives[0].selection.value;
  const leaf = { kind: "leaf", value: { ...original, future: {
    ...original.future, awaiting: "fallible", errorBoundary: "source-program",
  } } };
  const edge = { declaration: node, kind: "await", effects: { localErrors: false, nativeErrors: [] }, nativeErrors: [] };
  const operand = { kind: "call", path: "closed_generator_body", args: [] };
  const records = createRustRecordFixture({
    typeEmission: { get: () => ({ completion: "value", promiseObject: false }) },
    awaitErrorEdge: { get: (subject, carrier) => subject === node && carrier === original.carrier ? edge : undefined },
    sourceErrorRegion: { get: selected => selected === edge ? {
      operand: { kind: "infallible", fileName: "/src/index.ts", localOwner: undefined, sources: [] },
      local: undefined, channels: new Map(),
    } : undefined },
  });
  const selectedContext = { ...context, input: { program: { ...context.input.program, records } } };
  assert.equal(selectedContext.fallibleBoundary === undefined, true, "the source body has no possible error");
  const planned = planRustAwaitBranches(node, operand, leaf, undefined, selectedContext);
  assert.equal(planned.kind, "evaluate-then", "only the successful native output is discarded");
  const result = planned.effect;
  assert.equal(result.kind, "match", "the physical Result is unwrapped rather than leaked as the logical value");
  assert.equal(result.expression.kind, "await", "the real source future is awaited exactly once");
  assert.equal(result.expression.expr === operand, true, "there is no duplicate operand evaluation");
  assert.equal(result.arms[0].pattern.path, "Ok", "success preserves the exact native payload");
  assert.equal(result.arms[1].pattern.path, "Err", "the native protocol still has its uninhabited error arm");
  assert.equal(result.arms[1].expression.kind, "match", "the impossible error is eliminated natively");
  assert.equal(result.arms[1].expression.arms.length, 0, "no panic, conversion, runtime channel or boxed error is manufactured");
  assert.equal(selectedContext.diagnostics.length, 0, "no source rejection is added to infallible code");
  const missing = { ...selectedContext, input: { program: { ...selectedContext.input.program,
    records: createRustRecordFixture({ typeEmission: records.typeEmission,
      awaitErrorEdge: { get: () => undefined } }),
  } } };
  assert.throws(() => planRustAwaitBranches(node, operand, leaf, undefined, missing),
    /selected native error propagation/u, "missing body correspondence cannot masquerade as an uninhabited proof");
});

for (const errorBoundary of ["source-native", "provider-native"]) test(
  `${errorBoundary} awaits eliminate a sealed uninhabited error before requiring an outer error channel`, () => {
    const { node, context, selection } = discardedFixture();
    const original = selection.alternatives[0].selection.value;
    const errorCarrier = Object.freeze({ kind: "target-named", id: rustInfallibleTargetId });
    const program = rustProgramWithTypeEmissions([errorCarrier, original.carrier, original.future.outputCarrier]);
    const emitted = program.records.typeEmission.get(errorCarrier);
    assert.equal(emitted !== undefined, true, "the native error has the existing complete type-emission evidence");
    const selectedRecord = { ...emitted, completion: "never" };
    const records = createRustRecordFixture({
      typeEmission: { get: carrier => carrier === errorCarrier ? selectedRecord : program.records.typeEmission.get(carrier) },
    });
    const selectedContext = { ...context, input: { program: { ...context.input.program, records } } };
    const leaf = { kind: "leaf", value: { ...original, future: {
      ...original.future, awaiting: "fallible", errorBoundary, errorCarrier, errorSource: "provider:exact-empty-error",
    } } };
    const operand = { kind: "call", path: "native_pending", args: [] };
    const planned = planRustAwaitBranches(node, operand, leaf, undefined, selectedContext);
    assert.equal(planned.kind, "evaluate-then", "success is discarded only after its native effects");
    assert.equal(planned.effect.kind, "match", "the physical Result is consumed rather than leaked");
    assert.equal(planned.effect.expression.kind, "await", "the selected future is awaited once");
    assert.equal(planned.effect.expression.expr === operand, true, "the original operand remains one evaluation");
    const error = planned.effect.arms[1];
    assert.equal(error.pattern.path, "Err", "the selected physical error arm is explicit");
    assert.equal(error.expression.kind, "match", "the exact empty native enum is eliminated");
    assert.equal(error.expression.arms.length, 0, "no panic, error wrapper, conversion or hidden channel is added");
    const inhabited = { ...selectedContext, input: { program: { ...selectedContext.input.program,
      records: createRustRecordFixture({ typeEmission: { get: carrier => carrier === errorCarrier
        ? { ...selectedRecord, completion: "value" } : program.records.typeEmission.get(carrier) } }),
    } } };
    assert.throws(() => planRustAwaitBranches(node, operand, leaf, undefined, inhabited), /native error boundary/u,
      "a possibly inhabited native error still requires the selected outer error transport");
  });
