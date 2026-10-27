import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosureProducerFixture } from "../../../helpers/native-closure-producers.mjs";
import { rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { printRustType } from "../../../../dist/print/source/types.js";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "../../../../dist/target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinTargetType } from "../../../../dist/target-model/types/native-error-joins.js";

test("synchronous Future forwarding renders its exact deferred producer error", () => {
  const current = nativeClosureProducerFixture({ source: `import type { int32 } from "@tsonic/core/types.js";
export function retain(callback: () => Promise<int32>): Promise<int32> { return callback(); }
export function forward(callback: () => Promise<int32>): Promise<int32> { return retain(callback); }
export function create(): () => int32 { return (): int32 => { return 3; }; }
` });
  const { ast } = current.program.source;
  const producers = current.program.callableValues.nativeProducers;
  for (const name of ["retain", "forward"]) {
    const producer = producers.producers.find(producer => {
      const selected = ast.name(producer.declaration);
      return selected !== undefined && ast.text(selected) === name;
    });
    assert.equal(producer !== undefined, true, name);
    const error = producers.errorFor(producer.declaration, 0);
    const emission = current.program.records.typeEmission.get(error);
    assert.equal(emission?.producerError !== undefined, true, name + ": the original deferred error is admitted before rendering");
    assert.equal(Object.isFrozen(emission), true, name + ": the deferred native type selection is immutable");
    const rendered = rustTypeFromCarrierInContext(error, current.context);
    assert.equal(rendered !== undefined, true, name);
    assert.match(printRustType(rendered), /::AwaitError0/u);
    assert.doesNotMatch(printRustType(rendered), /TsonicError|ConsumerFailure|Infallible/u);
    const selected = rustProducerErrorReference(error);
    for (const [label, invalid] of [
      ["an absent completion ordinal never becomes a fabricated error", rustProducerErrorTargetType({ ...selected, channel: 4 })],
      ["missing producer environment remains rejected", rustProducerErrorTargetType({ ...selected, genericArguments: [] })],
    ]) {
      assert.equal(current.program.records.typeEmission.get(invalid) === undefined, true, label);
      let admitted;
      assert.throws(() => { admitted = rustTypeFromCarrierInContext(invalid, current.context); },
        failure => failure?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
          failure.diagnostic.message === "An admitted producer error requires its exact sealed native error carrier.", label);
      assert.equal(admitted === undefined, true, label + ": the required native consumer returns no type");
    }
  }
  const invalidJoin = rustNativeErrorJoinTargetType("/not-owned.ts", [
    { kind: "source-primitive", name: "int32" }, { kind: "source-primitive", name: "int64" },
  ]);
  assert.equal(current.program.records.typeEmission.get(invalidJoin) === undefined, true,
    "the unregistered source file has no admitted native join type");
  let admitted;
  assert.throws(() => { admitted = rustTypeFromCarrierInContext(invalidJoin, current.context); },
    failure => failure?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      failure.diagnostic.message === "An admitted native error join requires its exact sealed name and emitted source module.",
    "a join cannot invent a declaration in an unregistered source file");
  assert.equal(admitted === undefined, true, "a foreign native join returns no fabricated type");
});
