import assert from "node:assert/strict";
import test from "node:test";
import { planRustAwaitBranches } from "../../../../dist/backend/planner/expressions/await-completions.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustFutureTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../../dist/target-model/types/index.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

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
  const context = { input: { program: { source: { ast }, records } }, sourceFile,
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
