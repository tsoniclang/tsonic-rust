import assert from "node:assert/strict";
import test from "node:test";
import { applyFinalizedValueConversion } from "../../../../dist/backend/planner/expressions/value-conversions.js";
import { finalizeValueConversion } from "../../../../dist/analysis/facts/finalized-operation/conversions.js";
import { rustJsValueTargetType, rustJsArrayTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { selectRustSourceValueConversion } from "../../../../dist/policy/conversions/selection.js";
import { rustTargetRuntimeErrorType } from "../../../../dist/backend/planner/types/error-boundary.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustStringToBorrowedStrValueConversion, rustBorrowedStrToStringValueConversion } from "../../../../dist/public/provider.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

test("finalized conversions consume exact constructed inputs rather than rechecking an outer source node", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) },
    typeDefinitions: emptyRustTypeDefinitions, configuration: { edition: "2024" },
    facts: { getRuntimeCarrierFact: () => { throw new Error("outer node is not the constructed input"); } },
  } }, sourceFile, diagnostics: [], usedAliases: new Set() };
  const source = { kind: "path", path: "selected_present_value" };
  const borrow = finalizeValueConversion(rustStringToBorrowedStrValueConversion, rustStringTargetType());
  const own = finalizeValueConversion(rustBorrowedStrToStringValueConversion, borrow.targetCarrier);
  const sequence = { kind: "sequence", sourceCarrier: borrow.sourceCarrier,
    targetCarrier: own.targetCarrier, fallible: false, steps: [borrow, own] };
  assert.equal(sequence.kind, "sequence");
  const view = { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [source] };
  assert.deepEqual(applyFinalizedValueConversion(context, source, borrow, node, true), view);
  assert.deepEqual(applyFinalizedValueConversion(context, source, sequence, node, true), {
    kind: "owned-string-from-borrowed-str", expression: view,
  });
  for (const [label, mutation] of [
    ["missing conversion", { ...borrow, conversion: undefined }],
    ["wrong endpoint", { ...borrow, targetCarrier: rustStringTargetType() }],
    ["wrong effect", { ...borrow, fallible: true }],
    ["wrong source", { ...borrow, sourceCarrier: borrow.targetCarrier }],
    ["reordered sequence", { ...sequence, steps: [...sequence.steps].reverse() }],
  ]) {
    context.diagnostics.length = 0;
    assert.equal(applyFinalizedValueConversion(context, source, mutation, node, true), undefined, label);
    assert.equal(context.diagnostics.length, 1, label);
    assert.equal(context.diagnostics[0].code, "RUST_MISSING_TARGET_FACT", label);
  }
});

test("finalized fallible conversions retain their exact operand error type", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) },
    typeDefinitions: emptyRustTypeDefinitions, configuration: { edition: "2024" },
  } }, sourceFile, diagnostics: [], usedAliases: new Set(),
    fallibleBoundary: { errorTypePath: "crate::CurrentError", errorTypeIdentity: "test:CurrentError" } };
  const array = rustJsArrayTargetType(rustStringTargetType());
  const recovery = selectRustSourceValueConversion(rustJsValueTargetType(), array);
  const cases = [
    [recovery, "rt::JsError"],
    [{ kind: "option-map", elementConversion: recovery }, "rt::JsError"],
    [{ kind: "option-some", source: recovery.source, element: array, elementConversion: recovery }, "rt::JsError"],
    [{ kind: "exact-integer", source: { kind: "source-primitive", name: "float64" },
      target: { kind: "source-primitive", name: "uint64" } }, rustTargetRuntimeErrorType.path],
  ];
  for (const [conversion, errorPath] of cases) {
    const finalized = finalizeValueConversion(conversion);
    const lowered = applyFinalizedValueConversion(context, { kind: "path", path: "value" }, finalized, node, true);
    assert.equal(lowered?.kind, "try");
    assert.equal(lowered.operandErrorType.path, errorPath);
    assert.equal(lowered.resultErrorType.path, "crate::CurrentError");
    assert.equal(context.diagnostics.length, 0);
  }
});
