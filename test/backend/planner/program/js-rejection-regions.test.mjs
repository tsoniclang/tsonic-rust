import assert from "node:assert/strict";
import test from "node:test";
import { selectRustJsRejectionRegion } from "../../../../dist/policy/operations/flow/js-rejection.js";
import { planRustErrorRegion } from "../../../../dist/backend/planner/program/error-regions.js";
import { rustJsValueTargetType } from "../../../../dist/target-model/types/carriers/js.js";
import { rustRuntimeErrorTargetType } from "../../../../dist/target-model/types/carriers/runtime-carriers.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { rustTypeFromCarrier } from "../../../../dist/backend/planner/types/render.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("the actual body planner consumes selected JS rejection conversions without a native error enum", () => {
  const node = {};
  const source = (identity, errorType) => ({ identity, variant: identity === "js-rejection" ? "Error0" : "Error1", errorType });
  const sources = [source("js-rejection", rustJsValueTargetType()), source("native", rustRuntimeErrorTargetType())];
  const selected = { kind: "native", fileName: "/src/index.ts", localOwner: undefined, sources,
    jsRejection: selectRustJsRejectionRegion(undefined, sources) };
  const context = { input: { program: { records: createRustRecordFixture({
    nativeErrorRegion: { get: selectedNode => selectedNode === node ? selected : undefined } }) } }, usedAliases: new Set(),
    syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() } };
  const planned = planRustErrorRegion(node, context);
  assert.equal(planned?.boundary?.kind, "native");
  const boundary = planned.boundary;
  assert.equal(boundary.errorType.path, "js_abi::JsValue");
  assert.equal(boundary.join.items.length, 0);
  const error = { kind: "path", path: "error" };
  const pending = { kind: "path", path: "pending" };
  const jsSource = { identity: "js-rejection", errorType: rustTypeFromCarrier(rustJsValueTargetType()) };
  const nativeSource = { identity: "native", errorType: rustTypeFromCarrier(rustRuntimeErrorTargetType()) };
  assert.equal(boundary.join.inject(jsSource, error) === error, true);
  assert.equal(printRustExpr(boundary.join.inject(nativeSource, error)), "js_abi::JsValue::from_error(error)");
  assert.equal(printRustExpr(boundary.join.propagate(jsSource, pending)), "pending?");
  const propagated = boundary.join.propagate(nativeSource, pending);
  assert.equal(propagated.expr.method, "map_err");
  assert.equal(propagated.expr.receiver === pending, true);
  assert.equal(propagated.expr.args[0].body.args[0].path, propagated.expr.args[0].params[0].name);
  assert.equal(printRustExpr(propagated).includes("map_err::<js_abi::JsValue, _>"), true);
  assert.equal(boundary.join.accepts({ ...nativeSource, identity: "unselected" }), false);
  assert.equal(boundary.join.inject({ ...nativeSource, errorType: jsSource.errorType }, error) === undefined, true);
});

test("an infallible settled JS body needs neither an error channel nor generated names", () => {
  const selected = { kind: "infallible", fileName: "/src/index.ts", localOwner: undefined, sources: [],
    jsRejection: selectRustJsRejectionRegion(undefined, []) };
  const planned = planRustErrorRegion({}, { input: { program: { records: createRustRecordFixture({
    nativeErrorRegion: { get: () => selected } }) } } });
  assert.equal(planned !== undefined, true);
  assert.equal(planned.boundary === undefined, true);
});
