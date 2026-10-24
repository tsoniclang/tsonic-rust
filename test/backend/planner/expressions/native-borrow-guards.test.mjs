import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { acmeLogsinkCapability, analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { planRustSharedReceiver } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { applyFinalizedRustArgumentMode, applyRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";

const carrier = rustStringTargetType();
const node = {};
const declaration = {};
const borrowed = { kind: "borrow", mutable: false };

function context(storage, override, ownership = borrowed) {
  return {
    capturedBindings: [],
    expressionOverrides: new Map(override === undefined ? [] : [[node, override]]),
    input: { program: {
      source: { ast: { kindName: () => "KindIdentifier" } },
      records: createRustRecordFixture({
        sourceBinding: { get: () => ({ sourceDeclaration: declaration }) },
        bindingStorage: { get: () => storage === undefined ? undefined : { storage, valueCarrier: carrier } },
        argumentView: { get: () => ({ slice: false,
          borrowedStorage: storage === "borrow-cell" ? "borrow-guard" : "plain" }) },
        readOwnership: { get: () => ({ carrier, source: ownership, value: ownership,
          snapshot: undefined, stablePlace: true, readsStorage: true, pure: true,
          sharedReference: false, borrowedAcross: new Set() }) },
      }),
    } },
  };
}

test("a selected RefCell read retains the guard dereference in its native shared borrow", () => {
  const receiver = { kind: "call", path: "next_owner", args: [] };
  const guard = { kind: "method-call", receiver, method: "borrow", args: [] };
  const value = { kind: "dereference", pointer: guard };
  const planned = planRustSharedReceiver(node, value, context("borrow-cell"));
  assert.equal(planned.kind, "reference", "the AsRef input is a native payload reference");
  assert.equal(planned.expr === value, true, "retain &*guard rather than the Ref guard itself");
  assert.equal(planned.expr.pointer === guard, true, "the exact selected borrow operation occurs once");
  assert.equal(guard.receiver === receiver, true, "the original receiver evaluation is not replanned");
});

test("a selected borrowed array element keeps the same guarded place for native input shaping", () => {
  const pointer = { kind: "path", path: "element" };
  const value = { kind: "dereference", pointer };
  const override = { expression: value, carrier, valueForm: "storage", storageForm: "borrow-guard" };
  const planned = planRustSharedReceiver(node, value, context(undefined, override));
  assert.equal(planned.kind, "reference", "native element payload is borrowed");
  assert.equal(planned.expr === value, true, "the guard is not substituted for its payload place");
  assert.equal(planned.expr.pointer === pointer, true, "one selected element guard");
});

test("ordinary native references retain reference elision without a guard or clone", () => {
  const { program } = analyzeRust({ packages: [acmeLogsinkCapability()], files: { "index.ts": `
import { openSinkNamed } from "logsink";
export function read(value: string): void { openSinkNamed(value); }
` } });
  const inputs = program.physicalEmissionContexts.sourceOccurrences
    .filter(occurrence => occurrence.operation.abi.operationKind === "method")
    .flatMap(occurrence => occurrence.inputs).filter(({ input }) => input.source.kind === "argument" && input.source.sourceIndex === 0);
  assert.equal(inputs.length, 1, "the inverse is an actual identity/ref native String input");
  const selected = inputs[0];
  assert.equal(selected.input.conversion.kind, "identity", "no native conversion replaces the original parameter reference");
  assert.equal(selected.input.mode, "ref", "the exact native callee accepts the original shared String");
  assert.equal(program.records.sourceParameterAbi.get(selected.slot.node)?.mode, "ref",
    "a native reference is established at source ABI admission, never inferred from a dereference expression");
  assert.equal(program.records.providerReference.get(selected.slot.node, selected.input), true,
    "the selected unchanged native reference is admitted by the one provider-input owner");
  const pointer = { kind: "path", path: "reference" };
  const value = { kind: "dereference", pointer };
  const override = { expression: value, carrier, valueForm: "storage", storageForm: "plain" };
  const planned = applyFinalizedRustArgumentMode(rustSourceFilePlanContext(program, selected.slot.node),
    selected.slot.node, pointer, selected.input, true);
  assert.equal(planned === pointer, true, "native &T remains the existing reference, not &*reference");
  const unproven = planRustSharedReceiver(node, value, context(undefined, override));
  assert.equal(unproven.kind === "reference" && unproven.expr === value, true,
    "plain storage and a borrowing use alone do not prove that an arbitrary pointer is a native reference");
  const copied = planRustSharedReceiver(node, value, context(undefined, override, { kind: "copy" }));
  assert.equal(copied.kind, "reference", "a non-borrowing native place is explicitly borrowed");
  assert.equal(copied.expr === value, true, "a genuine place is not globally unwrapped");
});

test("the original JS String receiver passes its converted str reference without source-storage reuse", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function read(value: string): number { return value.indexOf("x"); }
console.log(read("x"));
` } });
  const inputs = program.physicalEmissionContexts.sourceOccurrences.flatMap(occurrence => occurrence.inputs)
    .filter(({ input }) => input.source.kind === "receiver");
  assert.equal(inputs.length, 1, "the original checked String receiver stays in the inverse matrix");
  const selected = inputs[0];
  assert.equal(selected.input.conversion.kind === "semantic" &&
    selected.input.conversion.conversion.kind === "semantic-conversion" &&
    selected.input.conversion.conversion.id === "borrowed-str-from-owned-string", true,
  "the real JS operation selects its native borrowed str conversion");
  assert.equal(selected.input.sharedConversion, true, "the first conversion borrows the source without a clone");
  assert.equal(selected.input.mode, "value", "the final str reference is passed by value");
  assert.equal(program.records.providerReference.get(selected.slot.node, selected.input), false,
    "a converted str is not relabelled as the original String parameter reference");
  const converted = { kind: "path", path: "converted_str_reference" };
  const planned = applyFinalizedRustArgumentMode(rustSourceFilePlanContext(program, selected.slot.node),
    selected.slot.node, converted, selected.input, false);
  assert.equal(planned === converted, true, "the exact converted value passes once, with no source reevaluation or extra borrow");
});

test("a finalized conversion never reads an original guarded source or discards the converted value", () => {
  const expression = { kind: "call", path: "convert_once", args: [] };
  const selected = { input: { program: {
    get records() { assert.fail("finalized native values have no source-storage authority"); },
  } } };
  for (const mode of ["ref", "mut-ref"]) {
    const planned = applyRustArgumentMode(selected, { stage: "finalized", expression }, mode);
    assert.equal(planned.kind, "reference", "borrow the selected final value");
    assert.equal(planned.expr === expression, true, "conversion and effects survive exactly once");
    assert.equal(planned.mutable === true, mode === "mut-ref", "native input mode is unchanged");
  }
});
