import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder, createRustProgramRecords } from "../../../../dist/analysis/program/records/create.js";
import { rustNamedTargetType, rustUnitTargetType } from "../../../../dist/target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../../dist/target-model/types/generic-arguments.js";

const errorCarrier = Object.freeze({ kind: "type-parameter", identity: "native-task-test:E", name: "E" });
const scope = Object.freeze({ name: "task_scope", errorCarrier,
  carrier: rustNamedTargetType("rust.runtime.TaskScope", "rt::TaskScope", rustTypeGenericArguments([errorCarrier])) });

test("native task roles publish through one required single-writer family", () => {
  const builder = createRustProgramRecordBuilder();
  const entries = [
    [{}, Object.freeze({ kind: "entry", scope })],
    [{}, Object.freeze({ kind: "owner", scope, binding: "borrowed-parameter" })],
    [{}, Object.freeze({ kind: "call", scope, passing: "borrow" })],
    [{}, Object.freeze({ kind: "spawn", scope, operand: {}, outputCarrier: rustUnitTargetType() })],
  ];
  for (const [subject, value] of entries) {
    builder.nativeTaskPlans.use(subject, value);
    assert.equal(builder.nativeTaskUse.get(subject) === value, true, "the writer and published reader share exact immutable evidence");
  }
  const sealed = builder.seal(entries.map(([subject]) => ({ subject, family: "nativeTaskUse", construct: "native-task-test", producer: "nativeTaskPlans" })));
  const published = createRustProgramRecords(sealed);
  assert.equal("nativeTaskPlans" in published, false, "the planner cannot publish or recompute task ownership");
  for (const [subject, value] of entries) assert.equal(published.nativeTaskUse.get(subject) === value, true,
    "every role remains the same pure lookup after publication");
  assert.equal(published.nativeTaskUse.get({}) === undefined, true, "an unrelated node receives no hidden scope");
});

test("native task evidence rejects duplicate producers and post-seal writes", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const value = Object.freeze({ kind: "owner", scope, binding: "owned-parameter" });
  builder.nativeTaskPlans.use(subject, value);
  assert.throws(() => builder.nativeTaskPlans.use(subject, value), /Duplicate Rust semantic plan/u,
    "even an identical second write cannot introduce another task owner");
  builder.seal([]);
  assert.throws(() => builder.nativeTaskPlans.use({}, value), /after analysis is sealed/u,
    "scope ABI decisions finish before the planner receives the program");
});

test("the required-record seal rejects an unpublished native task role", () => {
  const builder = createRustProgramRecordBuilder();
  assert.throws(() => builder.seal([{ subject: {}, family: "nativeTaskUse", construct: "explicit-void-task", producer: "native-task-analysis" }]),
    /Required Rust semantic plan 'nativeTaskUse' was not published/u,
    "the native-task record is enforced by the same seal as every other required decision");
});
