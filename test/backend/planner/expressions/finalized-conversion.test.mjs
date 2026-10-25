import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustPackageFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { applyFinalizedValueConversion } from "../../../../dist/backend/planner/expressions/value-conversions.js";
import { finalizeValueConversion, finalizedConversionIsValid } from "../../../../dist/policy/operations/members/abi/conversions.js";
import { rustJsValueTargetType, rustJsArrayTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { selectRustSourceValueConversion } from "../../../../dist/policy/conversions/selection.js";
import { rustTargetRuntimeErrorType } from "../../../../dist/backend/planner/types/error-boundary.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustStringToBorrowedStrValueConversion, rustBorrowedStrToStringValueConversion } from "../../../../dist/public/provider.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";
import { admitRustConversionEmission } from "../../../../dist/analysis/conversions/emission.js";
import { createRustConversionEmissionProducer } from "../../../../dist/analysis/program/records/conversion-emission.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";
import { rustJsErrorTargetType } from "../../../../dist/target-model/types/index.js";

test("finalized conversions consume exact constructed inputs rather than rechecking an outer source node", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const conversions = createRustConversionEmissionProducer(() => {});
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) },
    typeDefinitions: emptyRustTypeDefinitions, configuration: { edition: "2024" },
    records: createRustRecordFixture({ ...conversions.records,
      runtimeCarrier: { get: () => { throw new Error("outer node is not the constructed input"); } } }),
  } }, sourceFile, diagnostics: [], usedAliases: new Set() };
  const source = { kind: "path", path: "selected_present_value" };
  const borrow = finalizeValueConversion(rustStringToBorrowedStrValueConversion, rustStringTargetType());
  const own = finalizeValueConversion(rustBorrowedStrToStringValueConversion, borrow.targetCarrier);
  admitRustConversionEmission(conversions, borrow.conversion, emptyRustTypeDefinitions);
  admitRustConversionEmission(conversions, own.conversion, emptyRustTypeDefinitions);
  const sequence = { kind: "sequence", sourceCarrier: borrow.sourceCarrier,
    targetCarrier: own.targetCarrier, fallible: false, steps: [borrow, own] };
  assert.equal(sequence.kind, "sequence");
  const view = { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [source] };
  assert.deepEqual(applyFinalizedValueConversion(context, { stage: "finalized", expression: source }, borrow, node, true), view);
  assert.deepEqual(applyFinalizedValueConversion(context, { stage: "finalized", expression: source }, sequence, node, true), {
    kind: "owned-string-from-borrowed-str", expression: view,
  });
  for (const [label, mutation] of [
    ["missing conversion", { ...borrow, conversion: undefined }],
    ["wrong endpoint", { ...borrow, targetCarrier: rustStringTargetType() }],
    ["wrong effect", { ...borrow, fallible: true }],
    ["wrong source", { ...borrow, sourceCarrier: borrow.targetCarrier }],
    ["reordered sequence", { ...sequence, steps: [...sequence.steps].reverse() }],
  ]) {
    assert.equal(finalizedConversionIsValid(mutation, emptyRustTypeDefinitions), false,
      label + ": exact finalized transition is rejected at admission before rendering");
  }
});

test("finalized fallible conversions retain their exact operand error type", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const conversions = createRustConversionEmissionProducer(() => {});
  const array = rustJsArrayTargetType(rustStringTargetType());
  const recovery = selectRustSourceValueConversion(rustJsValueTargetType(), array);
  const cases = [
    [recovery, "rt::JsError"],
    [{ kind: "option-map", elementConversion: recovery }, "rt::JsError"],
    [{ kind: "option-some", source: recovery.source, element: array, elementConversion: recovery }, "rt::JsError"],
    [{ kind: "exact-integer", source: { kind: "source-primitive", name: "float64" },
      target: { kind: "source-primitive", name: "uint64" } }, rustTargetRuntimeErrorType.path],
  ].map(([conversion, errorPath]) => ({ conversion, errorPath, finalized: finalizeValueConversion(conversion) }));
  const program = rustProgramWithTypeEmissions([rustJsErrorTargetType(),
    ...cases.flatMap(({ finalized }) => [finalized.sourceCarrier, finalized.targetCarrier])], { surfaces: ["js"] });
  const context = { ...rustProgramPlanContext(program), input: { program: { ...program,
    records: createRustRecordFixture({ ...conversions.records }, program.records),
  } }, sourceFile, diagnostics: [], usedAliases: new Set(),
    fallibleBoundary: rustPackageFallibleBoundary({ componentId: "test", errorDomain: "project",
      errorTypePath: "crate::CurrentError", errorTypeIdentity: "test:CurrentError" }) };
  for (const [index, { conversion, errorPath, finalized }] of cases.entries()) {
    assert.equal(program.records.typeEmission.get(finalized.targetCarrier)?.positions.general, true,
      `${index}: the real native type owner admits this exact constructed result before rendering`);
    admitRustConversionEmission(conversions, conversion, program.typeDefinitions);
    const lowered = applyFinalizedValueConversion(context, { stage: "finalized", expression: { kind: "path", path: "value" } }, finalized, node, true);
    assert.equal(lowered?.kind, "try");
    assert.equal(lowered.operandErrorType.path, errorPath);
    assert.equal(lowered.resultErrorType.path, "crate::CurrentError");
    assert.equal(context.diagnostics.length, 0);
  }
});
