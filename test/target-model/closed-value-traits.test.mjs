import assert from "node:assert/strict";
import test from "node:test";
import { rustCarrierSupportsTrait, rustJsValueTargetType, rustTsValueTargetType } from "../../dist/target-model/types/index.js";

test("closed JS values expose their implemented default without inventing defaults for opaque native values", () => {
  assert.equal(rustCarrierSupportsTrait(rustJsValueTargetType(), "core::default::Default"), true);
  assert.equal(rustCarrierSupportsTrait(rustJsValueTargetType(), "core::clone::Clone"), true);
  assert.equal(rustCarrierSupportsTrait(rustTsValueTargetType(), "core::default::Default"), false);
});
