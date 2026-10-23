import assert from "node:assert/strict";
import test from "node:test";
import { rustAutoBorrowedReceiver } from "../../../../dist/backend/planner/expressions/auto-borrowed-receivers.js";
import { lowerRustValueConversion } from "../../../../dist/backend/planner/expressions/value-conversions.js";
import { planRustSequenceAppend } from "../../../../dist/backend/planner/expressions/sequence-conversions.js";
import { rustValueConversionContract } from "../../../../dist/policy/conversions/contracts.js";
import { selectRustRestSequenceConversion } from "../../../../dist/policy/conversions/rest-sequence.js";
import { rustJsArrayTargetType, rustJsValueTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("known shared native methods do not retain an unnecessary explicit receiver borrow", () => {
  const value = { kind: "path", path: "value" };
  const borrowed = { kind: "reference", expr: value };
  const mutable = { kind: "reference", mutable: true, expr: value };
  const dereferenced = { kind: "dereference", pointer: value };
  assert.equal(rustAutoBorrowedReceiver(borrowed) === value, true, "shared receiver is borrowed by native method syntax");
  assert.equal(rustAutoBorrowedReceiver(mutable) === mutable, true, "an exclusive borrow is not erased");
  assert.equal(rustAutoBorrowedReceiver(dereferenced) === dereferenced, true, "an arbitrary pointer dereference is never guessed to be a reference");
  const contract = rustValueConversionContract({ kind: "semantic-conversion", id: "borrowed-str-from-optional-string" });
  const planned = lowerRustValueConversion(contract, borrowed, {}, undefined);
  assert.equal(planned.receiver.receiver === value, true, "as_deref uses its exact native shared receiver");
  assert.equal(printRustExpr(planned), 'value.as_deref().unwrap_or("")', "the value is neither copied nor moved into a conversion");
  const effect = { kind: "call", path: "observe_once", args: [] };
  const selected = lowerRustValueConversion(contract, { kind: "reference", expr: effect }, {}, undefined);
  assert.equal(selected.receiver.receiver === effect, true, "an effectful receiver remains the same single expression");
});

test("native array recovery and sequence reads use the same shared-receiver syntax", () => {
  const element = rustStringTargetType();
  const source = rustJsValueTargetType();
  const array = rustJsArrayTargetType(element);
  const program = rustProgramWithTypeEmissions([element, source, array]);
  const context = rustProgramPlanContext(program);
  const value = { kind: "path", path: "value" };
  const borrowed = { kind: "reference", expr: value };
  const conversion = rustValueConversionContract({ kind: "js-array-backing", source, element });
  const planned = lowerRustValueConversion(conversion, borrowed, context, undefined);
  assert.equal(planned.receiver === value, true, "cast_array borrows the original closed value automatically");
  assert.equal(planned.method, "cast_array", "native recovery still validates the exact selected backing");
  const sequence = selectRustRestSequenceConversion(array, element);
  assert.equal(sequence !== undefined, true, "the selected native array has a closed sequence contract");
  const sequenceContract = rustValueConversionContract(sequence);
  const destination = { kind: "path", path: "destination" };
  const appended = planRustSequenceAppend(sequenceContract, borrowed, destination, context, undefined,
    () => { throw new Error("identity element transport does not request a conversion"); });
  assert.equal(appended.receiver === value, true, "with_values borrows the same source rather than a copied backing");
  assert.equal(appended.method, "with_values", "the existing native slice lease stays scoped to the callback");
  assert.equal(appended.args[0].body.receiver === destination, true, "only the destination is extended");
});
