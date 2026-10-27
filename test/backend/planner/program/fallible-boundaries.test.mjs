import assert from "node:assert/strict";
import test from "node:test";
import { rustErrorType, rustPackageFallibleBoundary, rustNativeFallibleBoundary,
  rustLocalErrorOwner, rustInjectLocalError, rustInjectNativeError,
  rustPropagateLocalError, rustPropagateNativeError } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { rustActiveErrorType, rustCurrentErrorBoundary } from "../../../../dist/backend/planner/program/plan-context.js";
import { planRustNativeErrorJoin } from "../../../../dist/backend/planner/types/native-error-joins.js";
import { applyRustErrorBoundary, applyRustLocalErrorBoundary, rustTargetRuntimeErrorType } from "../../../../dist/backend/planner/types/error-boundary.js";
import { applyRustFallibleResultExpression } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { checkRustDataWrite } from "../../../../dist/backend/planner/objects/data-writes.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../../../../dist/backend/planner/objects/project-objects.js";
import { analyzeRustSourcePackageErrorBoundaries } from "../../../../dist/analysis/errors/source-packages.js";
import { createRustSourcePackageEmissionProducer } from "../../../../dist/analysis/program/records/program/source-packages.js";

const owner = Object.freeze({ componentId: "root", errorDomain: "project",
  errorTypePath: "rt::TsonicError", errorTypeIdentity: "root:error" });
const local = { identity: "body:local", variant: "Local", errorType: rustErrorType(owner) };
const associated = { kind: "qualified", owner: { kind: "named", path: "Callback" },
  trait: { kind: "named", path: "Invocation" }, member: "Error" };
const callback = { identity: "callback:first", variant: "First", errorType: associated };
const localJoinPath = "BodyError::<rt::TsonicError, <Callback as Invocation>::Error>";
const equalJoinPath = "BodyError::<rt::TsonicError, rt::TsonicError, rt::TsonicError>";
const path = name => ({ kind: "path", path: name });
const call = name => ({ kind: "call", path: name, args: [] });
const join = sources => planRustNativeErrorJoin({ identity: "body:join", name: "BodyError", visibility: "private",
  resultShape: sources.length === 0 ? "value" : "result", sources });

test("active concrete regions preserve the genuine package owner and exact error type", () => {
  const region = rustPackageFallibleBoundary(owner);
  assert.equal(region.kind, "source-package");
  assert.equal(region.owner === owner, true);
  assert.equal(rustLocalErrorOwner(region) === owner, true);
  assert.equal(rustActiveErrorType({ fallibleBoundary: region }) === region.errorType, true);
  assert.equal(rustActiveErrorType({}) === undefined, true);
  const error = path("error");
  assert.equal(rustInjectLocalError(region, error) === error, true);
  assert.equal(rustInjectNativeError(region, callback, error) === undefined, true);
  assert.equal(rustPropagateNativeError(region, callback, path("result")) === undefined, true);
  const sourcePackageErrors = { componentIdByFileName: new Map(), componentIdByDefinition: new Map(),
    domainsByComponentId: new Map([["root", { componentId: "root", errorDomain: "project", errorTypeIdentity: "root:error",
      errorOwnerComponentId: "root", definitions: [] }]]), dependencyErrorsByComponentId: new Map() };
  const producer = createRustSourcePackageEmissionProducer(() => {});
  analyzeRustSourcePackageErrorBoundaries({ projectTypes: { programErrorDefinitions: [] } }, sourcePackageErrors, producer);
  const context = { fallibleBoundary: rustNativeFallibleBoundary(join([callback])), sourcePackageComponentId: "root",
    sourcePackageErrors, input: { program: { records: producer.records } } };
  assert.equal(rustCurrentErrorBoundary(context).componentId, "root");
  assert.equal(rustActiveErrorType(context) === associated, true);
});

test("an exact native package payload enters its package region without conversion or allocation", () => {
  const region = rustPackageFallibleBoundary(owner);
  const native = { identity: "selected:producer", errorType: rustErrorType(owner) };
  const error = path("original");
  assert.equal(rustInjectNativeError(region, native, error) === error, true);
  const result = call("invoke");
  assert.equal(rustPropagateNativeError(region, native, result).expr === result, true);
  for (const changed of [
    { ...native, errorType: associated },
    { ...native, errorType: { ...native.errorType, identity: "foreign:error" } },
    { ...native, errorType: { kind: "named", path: "rt::TsonicError" } },
  ]) {
    assert.equal(rustInjectNativeError(region, changed, error) === undefined, true);
    assert.equal(rustPropagateNativeError(region, changed, result) === undefined, true);
  }
});

test("single associated error regions have no invented package owner or local error channel", () => {
  const region = rustNativeFallibleBoundary(join([callback]));
  assert.equal(region.kind, "native");
  assert.equal(region.errorType === associated, true);
  assert.equal("componentId" in region, false);
  assert.equal("errorDomain" in region, false);
  assert.equal("owner" in region, false);
  assert.equal(rustLocalErrorOwner(region) === undefined, true);
  assert.equal(rustInjectLocalError(region, path("error")) === undefined, true);
  assert.equal(rustPropagateLocalError(region, local.errorType, path("result")) === undefined, true);
  const error = path("error");
  const result = path("result");
  assert.equal(rustInjectNativeError(region, callback, error) === error, true);
  const propagated = rustPropagateNativeError(region, callback, result);
  assert.equal(propagated.expr === result, true);
  assert.equal(propagated.operandErrorType === associated && propagated.resultErrorType === associated, true);
  assert.equal(rustNativeFallibleBoundary(join([])) === undefined, true);
});

test("native local channels require the exact selected identity and genuine package carrier", () => {
  const joined = join([local, callback]);
  const selected = { owner, source: local };
  const region = rustNativeFallibleBoundary(joined, selected);
  assert.equal(region !== undefined, true);
  assert.equal(region.errorType === joined.errorType, true);
  assert.equal(rustLocalErrorOwner(region) === owner, true);
  assert.equal(Object.isFrozen(region.local) && Object.isFrozen(region.local.source), true);
  for (const malformed of [
    { owner, source: { ...local, identity: "foreign" } },
    { owner, source: { ...local, errorType: associated } },
    { owner: { ...owner, errorTypeIdentity: "other:error" }, source: local },
    { owner, source: callback },
  ]) assert.equal(rustNativeFallibleBoundary(joined, malformed) === undefined, true);
  const alias = { ...owner, errorTypePath: "alias::TsonicError" };
  assert.equal(rustNativeFallibleBoundary(joined, { owner: alias, source: local }) !== undefined, true);
});

test("local throws enter their owned enum variant without From or copying", () => {
  const region = rustNativeFallibleBoundary(join([local, callback]), { owner, source: local });
  const original = path("original");
  const injected = rustInjectLocalError(region, original);
  assert.equal(injected.args[0] === original, true);
  assert.equal(printRustExpr(injected), `${localJoinPath}::Local(original)`);
  const propagated = rustPropagateLocalError(region, local.errorType, call("local_call"));
  assert.equal(printRustExpr(propagated), `local_call().map_err(${localJoinPath}::Local)?`);
  assert.equal(propagated.operandErrorType === region.errorType && propagated.resultErrorType === region.errorType, true);
  assert.equal(applyRustFallibleResultExpression(propagated, region) === propagated.expr, true);
});

test("concrete operation errors convert at their package owner before entering a native join", () => {
  const concrete = rustPackageFallibleBoundary(owner);
  const region = rustNativeFallibleBoundary(join([local, callback]), { owner, source: local });
  const result = call("operation");
  const old = applyRustErrorBoundary(result, "target-runtime", concrete.errorType);
  const preserved = applyRustLocalErrorBoundary(result, "target-runtime", concrete);
  assert.equal(printRustExpr(preserved), printRustExpr(old));
  assert.equal(preserved.expr === result, true);
  assert.equal(preserved.operandErrorType === rustTargetRuntimeErrorType, true);
  const propagated = applyRustLocalErrorBoundary(result, "target-runtime", region);
  assert.equal(printRustExpr(propagated), `operation().map_err(rt::TsonicError::from).map_err(${localJoinPath}::Local)?`);
  assert.equal(propagated.operandErrorType === region.errorType && propagated.resultErrorType === region.errorType, true);
  assert.equal(printRustExpr(applyRustLocalErrorBoundary(result, "source-program", region)),
    `operation().map_err(${localJoinPath}::Local)?`);
  const provider = { kind: "named", path: "std::io::Error" };
  assert.equal(printRustExpr(applyRustLocalErrorBoundary(result, "provider-native", region, provider)), printRustExpr(propagated));
  assert.throws(() => applyRustLocalErrorBoundary(result, "provider-native", region), /exact provider error type/u);
});

test("native channels remain distinct when actual error types coincide, including with the local carrier", () => {
  const first = { ...callback, errorType: local.errorType };
  const second = { ...first, identity: "callback:second", variant: "Second" };
  const region = rustNativeFallibleBoundary(join([local, first, second]), { owner, source: local });
  for (const selected of [first, second]) {
    const propagated = rustPropagateNativeError(region, selected, call("callback"));
    assert.equal(printRustExpr(propagated), `callback().map_err(${equalJoinPath}::${selected.variant})?`);
    assert.equal(propagated.operandErrorType === region.errorType && propagated.resultErrorType === region.errorType, true);
  }
  for (const changed of [{ ...first, identity: "foreign" }, { ...first, errorType: associated }]) {
    assert.equal(rustPropagateNativeError(region, changed, path("result")) === undefined, true);
    assert.equal(rustInjectNativeError(region, changed, path("error")) === undefined, true);
  }
  assert.equal(printRustExpr(rustPropagateLocalError(region, local.errorType, call("callback"))),
    `callback().map_err(${equalJoinPath}::Local)?`);
});

test("runtime data-write guards enter the selected local channel and fail closed without one", () => {
  const concrete = rustPackageFallibleBoundary(owner);
  const region = rustNativeFallibleBoundary(join([local, callback]), { owner, source: local });
  const nativeOnly = rustNativeFallibleBoundary(join([callback]));
  const receiver = path("receiver");
  const effect = call("write");
  const checked = checkRustDataWrite("receiver", receiver, effect, region);
  assert.equal(checked.value === effect, true);
  assert.equal(printRustExpr(checked.effect), `receiver.validate_data_write().map_err(rt::TsonicError::from).map_err(${localJoinPath}::Local)?`);
  const previous = checkRustDataWrite("receiver", receiver, effect, concrete);
  assert.equal(previous.effect.expr.receiver === receiver, true);
  assert.equal(previous.effect.operandErrorType === rustTargetRuntimeErrorType, true);
  assert.equal(previous.effect.resultErrorType === concrete.errorType, true);
  assert.equal(checkRustDataWrite("receiver", receiver, effect, nativeOnly) === undefined, true);
});

test("field dispatch preserves pure access and routes fallible reads and writes through the real local owner", () => {
  const receiver = call("receiver");
  const region = rustNativeFallibleBoundary(join([local, callback]), { owner, source: local });
  const role = { fallible: true, selfMode: "ref", region, operandErrorType: local.errorType };
  assert.equal(readRustProjectDispatchedField(receiver, "read").kind, "method-call");
  assert.equal(printRustExpr(readRustProjectDispatchedField(receiver, "read", role)),
    `receiver().dispatch.read().map_err(${localJoinPath}::Local)?`);
  const write = writeRustProjectDispatchedField(receiver, "selected", "read", "write", "+=", path("value"), { read: role, write: role });
  const printed = printRustExpr(write);
  assert.equal((printed.match(/receiver\(\)/gu) ?? []).length, 1);
  assert.equal(printed.split(`map_err(${localJoinPath}::Local)`).length - 1, 2);
  assert.doesNotMatch(printed, /::from|\.clone\(/u);
  const unowned = { ...role, region: rustNativeFallibleBoundary(join([callback])) };
  assert.equal(readRustProjectDispatchedField(receiver, "read", unowned) === undefined, true);
  assert.equal(writeRustProjectDispatchedField(receiver, "selected", "read", "write", "+=", path("value"),
    { read: unowned, write: role }) === undefined, true);
  assert.equal(writeRustProjectDispatchedField(receiver, "selected", "read", "write", "=", path("value"),
    { read: role, write: unowned }) === undefined, true);
});
