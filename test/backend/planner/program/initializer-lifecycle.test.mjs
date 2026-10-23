import assert from "node:assert/strict";
import test from "node:test";
import { planRustInitializerLifecycleResult } from "../../../../dist/backend/planner/program/initializer-lifecycle.js";
import { planRustNativeErrorJoin } from "../../../../dist/backend/planner/types/native-error-joins.js";
import { rustNativeFallibleBoundary, rustPackageFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const localOwner = Object.freeze({ componentId: "root", errorDomain: "runtime",
  errorTypePath: "tsonic_rust_runtime::TsonicError", errorTypeIdentity: "root-error" });
const local = { identity: "local", variant: "Local", errorType: {
  kind: "named", path: localOwner.errorTypePath, identity: localOwner.errorTypeIdentity,
} };
const first = { identity: "/src/worker.ts", variant: "Worker", errorType: {
  kind: "named", path: "worker_native::Failure", identity: "worker-error",
} };
const foreign = { identity: "/pkg/foreign.ts", variant: "Foreign", errorType: {
  kind: "named", path: "foreign_package::program::TsonicError", identity: "foreign-program-error",
} };
const operation = { kind: "call", path: "initialize", args: [] };

function boundary(name, sources, localSource) {
  const join = planRustNativeErrorJoin({ identity: name, name, visibility: "public", sources });
  assert.equal(join !== undefined, true, "the native syntax join is complete");
  const selected = rustNativeFallibleBoundary(join, localSource === undefined ? undefined : {
    owner: localOwner, source: localSource,
  });
  assert.equal(selected !== undefined, true, "the local source, when present, is the exact package carrier");
  return selected;
}

test("a package initializer enters the same lifecycle local channel without conversion", () => {
  const native = rustPackageFallibleBoundary(localOwner);
  const selected = planRustInitializerLifecycleResult({ kind: "package", owner: {
    kind: "physical", domain: "runtime",
  } }, native, native, operation);
  assert.equal(printRustExpr(selected), "initialize()?", "the identical native package error propagates directly");
  assert.doesNotMatch(printRustExpr(selected), /from|clone|Box|unwrap/u, "no facade or compatibility conversion is added");
});

test("all selected module payloads and the local channel map once into the existing lifecycle join", () => {
  const source = boundary("InitializationErrors", [local, first, foreign], local);
  const target = boundary("LifecycleErrors", [
    { ...foreign, variant: "Error1" }, { ...local, identity: "package:root-error", variant: "Error0" },
    { ...first, variant: "Error2" },
  ], { ...local, identity: "package:root-error" });
  const selection = { kind: "native", owner: { kind: "physical", domain: "runtime" }, sources: [
    { kind: "package", identity: local.identity, variant: local.variant },
    { kind: "module", identity: first.identity, variant: first.variant, sourceFile: Object.freeze({}) },
    { kind: "module", identity: foreign.identity, variant: foreign.variant, sourceFile: Object.freeze({}) },
  ] };
  const selected = planRustInitializerLifecycleResult(selection, source, target, operation);
  assert.equal(selected.kind, "try", "the initializer returns through the single lifecycle Result");
  const mapped = selected.expr.args[0].body;
  assert.equal(mapped.arms.length, 3, "every original initializer error arm is retained");
  assert.equal(mapped.arms[0].expression.method, "Error0", "the local package uses only its selected local arm");
  assert.equal(mapped.arms[1].expression.method, "Error2", "the worker keeps its exact module identity, not its position");
  assert.equal(mapped.arms[2].expression.method, "Error1", "the foreign package error remains its own native module payload");
  assert.equal(mapped.arms.every(arm => arm.expression.args[0].path === "initializer_payload"), true,
    "each native payload moves directly once without reconstruction");
  assert.doesNotMatch(printRustExpr(selected), /from|clone|Box|unwrap/u, "no foreign error narrows through the root error type");
  const absent = boundary("MissingWorker", [local, foreign], local);
  assert.throws(() => planRustInitializerLifecycleResult(selection, source, absent, operation), /exact original module and local lifecycle channels/u,
    "an equal display name never substitutes for a missing selected worker channel");
  const wrongCarrier = boundary("WrongForeign", [local, first, { ...foreign, errorType: first.errorType }], local);
  assert.throws(() => planRustInitializerLifecycleResult(selection, source, wrongCarrier, operation), /exact original module and local lifecycle channels/u,
    "a selected identity cannot mask a mismatched native payload carrier");
});
