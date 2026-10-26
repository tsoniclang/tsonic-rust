import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativeArrayElementPlan } from "../../../../dist/policy/operations/collections/native-arrays.js";
import { selectRustNativeIndex } from "../../../../dist/policy/operations/collections/native-indices.js";
import { rustTargetTypeChildren } from "../../../../dist/target-model/types/carriers/children.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";

test("native array requirements project the exact element through owned and borrowed storage", () => {
  const index = selectRustNativeIndex(rustSourcePrimitiveTargetType("int32"));
  const element = rustStringTargetType();
  const receivers = [
    { kind: "array", element },
    { kind: "reference", mutable: false, referent: { kind: "slice", element } },
    { kind: "reference", mutable: true, referent: { kind: "slice", element }, lifetime: { kind: "static" } },
  ];
  for (const receiver of receivers) {
    for (const owner of ["Array", "ReadonlyArray"]) {
      for (const accessMode of ["read", "read-write"]) {
        const selected = selectRustNativeArrayElementPlan(owner, receiver, index, accessMode);
        assert.equal(selected.resultCarrier === element, true, "the authored element carrier is unchanged");
        assert.equal(selected.carrierRequirements.length, 1, "a non-Copy indexed read retains its Clone obligation");
        const requirement = selected.carrierRequirements[0];
        assert.equal(requirement.carrier === element, true, "Clone refers to the actual element, not its backing slice");
        assert.equal(requirement.requirement, "clone");
        assert.equal(requirement.source.kind, "receiver");
        assert.deepEqual(requirement.source.projection, receiver.kind === "array" ? [0] : [0, 0]);
        let component = receiver;
        for (const step of requirement.source.projection) component = rustTargetTypeChildren(component)[step];
        assert.equal(component === element, true, "the complete source path reaches exactly the selected component");
        assert.equal(selectRustNativeArrayElementPlan(owner, receiver, index, "write").carrierRequirements === undefined,
          true, "a write does not acquire an element Clone requirement");
      }
    }
  }
});

test("native Copy element reads require no clone for owned or borrowed arrays", () => {
  const element = rustSourcePrimitiveTargetType("int32");
  const index = selectRustNativeIndex(element);
  for (const receiver of [{ kind: "array", element },
    { kind: "reference", mutable: false, referent: { kind: "slice", element } }]) {
    const selected = selectRustNativeArrayElementPlan("ReadonlyArray", receiver, index, "read");
    assert.equal(selected.carrierRequirements === undefined, true, "Copy reads do not manufacture a Clone obligation");
    assert.equal(selected.resultCarrier === element, true, "Copy preserves the exact native element carrier");
  }
});
