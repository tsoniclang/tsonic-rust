import assert from "node:assert/strict";
import test from "node:test";
import { bindRustStructuralReceiverParameters } from "../../../dist/analysis/declarations/structural-receiver-requirements.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";

const parameter = { kind: "type-parameter", identity: "factory:Owner", name: "Owner" };
const value = { kind: "source-primitive", name: "float64" };
const text = { kind: "target-named", id: "rust.String" };
const fields = carrier => ["owner", "selected"].map(sourceName => ({ sourceName, type: carrier,
  readonly: false, presence: "required" }));
const shape = (carrier, owner = "/factory.ts", selected = fields(carrier)) =>
  rustStructuralObjectTargetType(owner, selected, "reference");

test("structural receiver obligations bind exact identities without generic name matching", () => {
  const bindings = bindRustStructuralReceiverParameters(shape(parameter), shape(value), new Set([parameter.identity]));
  assert.equal(bindings?.size, 1);
  assert.equal(bindings?.get(parameter.identity) === value, true);
  assert.equal(bindRustStructuralReceiverParameters(shape(parameter), shape(value), new Set(["other:Owner"])) === undefined, true);
});

test("structural receiver obligations reject contradictory, foreign and incomplete carriers", () => {
  for (const [name, actual] of [
    ["foreign owner", shape(value, "/foreign.ts")],
    ["conflicting occurrence", shape(value, "/factory.ts", [fields(value)[0], fields(text)[1]])],
    ["missing field", shape(value, "/factory.ts", fields(value).slice(0, 1))],
    ["optional field", shape(value, "/factory.ts", fields(value).map(field => ({ ...field, presence: "optional" })))],
    ["readonly field", shape(value, "/factory.ts", fields(value).map(field => ({ ...field, readonly: true })))],
    ["non-structural", value],
  ]) assert.equal(bindRustStructuralReceiverParameters(shape(parameter), actual, new Set([parameter.identity])) === undefined, true, name);
});
