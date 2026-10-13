import assert from "node:assert/strict";
import test from "node:test";
import { defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { createRustEffectsWorkBudget, defaultRustEffectsWorkLimit }
  from "../../../dist/analysis/resources/effects-work-budget.js";
import { mergeRustErrorEffects } from "../../../dist/analysis/errors/error-effects.js";

test("effects use the canonical finite source-analysis work default", () => {
  assert.equal(defaultRustEffectsWorkLimit, defaultSourceStorageLimits.maximumSteps);
  assert.equal(Object.isFrozen(createRustEffectsWorkBudget()), true);
});

test("one aggregate effect budget accounts repeated work and stops at its exact boundary", () => {
  const budget = createRustEffectsWorkBudget(7);
  let visited = 0;
  assert.equal(budget.run(() => { budget.step(6); budget.step(); }) === undefined, true);
  const failure = budget.run(() => { budget.step(); visited += 1; });
  assert.equal(failure?.code, "RUST_ERROR_EFFECTS_WORK_LIMIT");
  assert.equal(visited, 0);
  assert.equal(budget.run(() => { visited += 1; }) === failure, true, "exhaustion is terminal");
  assert.equal(visited, 0);
});

test("malformed and nonfinite effect limits cannot start analysis", () => {
  for (const maximum of [0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "20", null, {}]) {
    let started = false;
    const failure = createRustEffectsWorkBudget(maximum).run(() => { started = true; });
    assert.equal(failure?.code, "RUST_ERROR_EFFECTS_WORK_INVALID", String(maximum));
    assert.equal(started, false);
  }
});

test("reservations reject invalid costs and use checked subtraction at the safe-integer boundary", () => {
  for (const cost of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    const owner = createRustEffectsWorkBudget();
    assert.equal(owner.run(() => owner.step(cost))?.code, "RUST_ERROR_EFFECTS_WORK_INVALID");
  }
  const owner = createRustEffectsWorkBudget(Number.MAX_SAFE_INTEGER);
  assert.equal(owner.run(() => owner.step(Number.MAX_SAFE_INTEGER - 1)) === undefined, true);
  assert.equal(owner.run(() => owner.step(2))?.code, "RUST_ERROR_EFFECTS_WORK_LIMIT");
});

test("metadata work counts repeated aliases, nested structures and identity text", () => {
  const shared = { kind: "type-parameter", identity: "callback/type", name: "Callback" };
  const owner = createRustEffectsWorkBudget(10_000);
  let repeated;
  let copied;
  let short;
  let long;
  assert.equal(owner.run(() => {
    repeated = owner.metadata([shared, shared]);
    copied = owner.metadata([structuredClone(shared), structuredClone(shared)]);
    short = owner.metadata({ identity: "source" });
    long = owner.metadata({ identity: "source".repeat(100) });
  }) === undefined, true);
  assert.equal(repeated, copied, "snapshots and normalization must charge each occurrence, not just distinct objects");
  assert.equal(long > short, true, "large exact identities consume work as well as carrier nodes");
  const limited = createRustEffectsWorkBudget(10);
  assert.equal(limited.run(() => limited.metadata([shared]))?.code, "RUST_ERROR_EFFECTS_WORK_LIMIT");
});

test("cyclic or accessor metadata fails closed without executing accessors", () => {
  const cyclic = {};
  cyclic.next = cyclic;
  let read = false;
  for (const metadata of [cyclic, { get value() { read = true; return 1; } }, { value: () => 1 }]) {
    const owner = createRustEffectsWorkBudget(100);
    assert.equal(owner.run(() => owner.metadata(metadata))?.code, "RUST_ERROR_EFFECTS_WORK_INVALID");
  }
  assert.equal(read, false);
});

test("the budget never suppresses unrelated compiler defects", () => {
  const failure = new Error("independent owner failure");
  assert.throws(() => createRustEffectsWorkBudget().run(() => { throw failure; }), error => error === failure);
});

test("one substitution reserves its possible expansion before allocation without overflowing the counter", () => {
  let expanded = false;
  const owner = createRustEffectsWorkBudget(100);
  assert.equal(owner.run(() => owner.expansion(10, 10)) === undefined, true);
  assert.equal(owner.run(() => owner.step())?.code, "RUST_ERROR_EFFECTS_WORK_LIMIT");
  const overflowing = createRustEffectsWorkBudget(Number.MAX_SAFE_INTEGER);
  assert.equal(overflowing.run(() => {
    overflowing.expansion(Number.MAX_SAFE_INTEGER, 2);
    expanded = true;
  })?.code, "RUST_ERROR_EFFECTS_WORK_LIMIT");
  assert.equal(expanded, false, "an overflowing reservation cannot execute normalization");
  for (const [source, replacement] of [[0, 1], [1, 0], [-1, 1], [1, NaN], [Infinity, 1], [1, 0.5]]) {
    const invalid = createRustEffectsWorkBudget();
    assert.equal(invalid.run(() => invalid.expansion(source, replacement))?.code, "RUST_ERROR_EFFECTS_WORK_INVALID");
  }
});

test("a large independent channel family is bounded by actual work rather than an origin-count ceiling", () => {
  const selected = { localErrors: false, nativeErrors: Array.from({ length: 8192 }, (unused, index) => ({
    identity: `source/${index}`, errorType: { kind: "source-primitive", name: "int32" },
  })) };
  const budget = createRustEffectsWorkBudget(4_000_000);
  let normalized;
  assert.equal(budget.run(() => {
    budget.metadata(selected);
    normalized = mergeRustErrorEffects([selected]);
    budget.metadata(normalized);
  }) === undefined, true);
  assert.equal(normalized.nativeErrors.length, selected.nativeErrors.length);
});
