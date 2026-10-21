import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustFoundation } from "../../../dist/analysis/foundation/finalization.js";
import { rustFoundationForCarrier, rustFoundationForPath } from "../../../dist/analysis/foundation/requirements.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";

test("source foundation finalization admits core metadata without inventing executable allocation", () => {
  const result = finalizeRustFoundation({ selected: "core", required: "core" }, "core");
  assert.deepEqual(result.plan, { selected: "core", required: "core" });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(Object.isFrozen(result.plan) && Object.isFrozen(result.diagnostics), true);
});

test("native allocation and runtime requirements are refused before syntax construction", () => {
  for (const [requirement, expected] of [
    [rustFoundationForCarrier(rustStringTargetType()), "alloc"],
    [rustFoundationForCarrier({ kind: "array", element: { kind: "source-primitive", name: "int32" } }), "alloc"],
    [rustFoundationForPath("std::process::exit"), "std"],
    ["std", "std"],
  ]) {
    assert.equal(requirement, expected);
    const result = finalizeRustFoundation({ selected: "core", required: "core" }, requirement);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED");
    assert.equal(result.diagnostics[0].evidence.includes("rust.foundation.required=" + expected), true,
      "the exact native or provider-acquired requirement is retained before sealing");
  }
});

test("native formatter contracts do not invent an allocation requirement", () => {
  const required = rustFoundationForPath("core::fmt::Write");
  assert.equal(required, "core");
  assert.deepEqual(finalizeRustFoundation({ selected: "core", required: "core" }, required).diagnostics, []);
});
