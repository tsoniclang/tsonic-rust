import assert from "node:assert/strict";
import test from "node:test";
import { rustCarrierSupportsTrait, rustJsValueTargetType, rustTsValueTargetType } from "../../dist/target-model/types/index.js";
import { isRustCopyCarrier } from "../../dist/target-model/types/carriers/traits.js";
import { rustOptionTargetType } from "../../dist/target-model/types/carriers/optional.js";
import { rustFixedArrayTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustStructuralObjectTargetType } from "../../dist/target-model/types/carriers/source-types.js";

test("closed JS values expose their implemented default without inventing defaults for opaque native values", () => {
  assert.equal(rustCarrierSupportsTrait(rustJsValueTargetType(), "core::default::Default"), true);
  assert.equal(rustCarrierSupportsTrait(rustJsValueTargetType(), "core::clone::Clone"), true);
  assert.equal(rustCarrierSupportsTrait(rustTsValueTargetType(), "core::default::Default"), true);
  assert.equal(rustCarrierSupportsTrait({ kind: "target-named", id: "acme.Opaque" }, "core::default::Default"), false);
});

test("native Copy composition retains exact sealed leaf proofs through aggregate storage", () => {
  const leaf = { kind: "target-named", id: "test.closed-callable" };
  const proof = selected => selected === leaf;
  const variants = [leaf, rustOptionTargetType(leaf), { kind: "tuple", elements: [leaf] },
    rustFixedArrayTargetType(leaf, 2), rustStructuralObjectTargetType("/source.ts", [
      { sourceName: "value", type: leaf, presence: "required", readonly: false },
    ], "value")];
  for (const carrier of variants) {
    assert.equal(isRustCopyCarrier(carrier), false);
    assert.equal(isRustCopyCarrier(carrier, proof), true);
  }
  assert.equal(isRustCopyCarrier({ ...leaf }, proof), false);
  assert.equal(isRustCopyCarrier({ kind: "array", element: leaf }, proof), false);
  assert.equal(isRustCopyCarrier({ kind: "tuple", elements: [leaf, { kind: "array", element: leaf }] }, proof), false);
  assert.equal(isRustCopyCarrier(undefined, proof), false);
});
