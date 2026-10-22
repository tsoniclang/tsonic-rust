import assert from "node:assert/strict";
import test from "node:test";
import { rustTypeFromCarrier } from "../../../../dist/backend/planner/types/carrier-syntax.js";
import { rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustProgramErrorTargetType, rustVecTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustSourcePackageErrorBoundaries, rustSourcePackageErrorTypeIdentity } from "../../../../dist/analysis/errors/source-packages.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustRuntimeErrorTypeIdentity } from "../../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustTypeEquals } from "../../../../dist/backend/target-ast/syntax/type-equality.js";
import { rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

// Type emission records for the program error carriers rendered below, selected by their analysis owner.
const emitted = rustProgramWithTypeEmissions([rustProgramErrorTargetType(), rustVecTargetType(rustProgramErrorTargetType()),
  rustProgramErrorTargetType({ kind: "physical", domain: "runtime" })]);

// A rendering context for one component in errorDomain, whose error boundaries are sealed by
// analyzeRustSourcePackageErrorBoundaries over that component's error plan (an empty plan when not selected).
function context(componentId, errorDomain, selected = true) {
  const errors = { componentIdByFileName: new Map(), componentIdByDefinition: new Map(),
    domainsByComponentId: new Map(selected ? [[componentId, { componentId, errorDomain,
      errorOwnerComponentId: errorDomain === "project" ? componentId : undefined,
      errorTypeIdentity: rustSourcePackageErrorTypeIdentity(componentId, errorDomain), definitions: [], externalErrors: [] }]] : []),
    dependencyErrorsByComponentId: new Map() };
  const builder = createRustProgramRecordBuilder();
  analyzeRustSourcePackageErrorBoundaries({ projectTypes: { programErrorDefinitions: [] } }, errors, builder.sourcePackageEmission);
  return { usedAliases: new Set(), sourcePackageComponentId: componentId, sourcePackageErrors: errors,
    input: { program: { source: emitted.source, records: { ...emitted.records,
      sourcePackageErrorBoundary: builder.readers.sourcePackageErrorBoundary,
      physicalProgramErrorBoundary: builder.readers.physicalProgramErrorBoundary } } } };
}

test("program error rendering preserves scoped ABI identity recursively", () => {
  for (const errorDomain of ["runtime", "project"]) {
    const scope = context("owner", errorDomain);
    const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), scope);
    assert.equal(error.kind, "named");
    assert.equal(error.identity, rustSourcePackageErrorTypeIdentity("owner", errorDomain));
    assert.equal(error.path, "rt::TsonicError");
    const nested = rustTypeFromCarrierInContext(rustVecTargetType(rustProgramErrorTargetType()), scope);
    assert.equal(rustTypeEquals(error, nested.genericArguments[0].type), true);
    assert.equal(scope.usedAliases.has("rt"), true);
  }
});

test("error equality uses exact domain identities rather than equal alias spelling", () => {
  const runtime = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context("runtime", "runtime"));
  assert.equal(runtime.identity, rustRuntimeErrorTypeIdentity);
  assert.equal(rustTypeEquals(runtime, { ...runtime, path: "tsonic_rust_runtime::TsonicError" }), true);
  const first = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context("first", "project"));
  const second = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context("second", "project"));
  assert.equal(first.path, second.path);
  assert.equal(rustTypeEquals(first, second), false);
  assert.equal(rustTypeEquals(first, { kind: "named", path: first.path }), false);
});

test("physical runtime errors reuse only the actual native runtime alias and never a project error alias", () => {
  for (const errorDomain of ["runtime", "project"]) {
    const scope = context("consumer", errorDomain);
    const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType({ kind: "physical", domain: "runtime" }), scope);
    assert.equal(error.identity, rustRuntimeErrorTypeIdentity);
    assert.equal(error.path, errorDomain === "runtime" ? "rt::TsonicError" : "tsonic_rust_runtime::TsonicError");
    assert.equal(scope.usedAliases.has("rt"), errorDomain === "runtime", "only the matching runtime alias is activated");
  }
});

test("program error rendering fails closed without its selected domain or with malformed arity", () => {
  assert.equal(rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context("owner", "project", false)) === undefined, true);
  const { sourcePackageErrors: _errors, ...unscoped } = context("owner", "project");
  assert.equal(rustTypeFromCarrierInContext(rustProgramErrorTargetType(), unscoped) === undefined, true);
  assert.equal(rustTypeFromCarrier(rustProgramErrorTargetType()) === undefined, true);
  // A malformed carrier has no sealed type emission record: rendering it is a planner invariant (no-fallback rule).
  assert.throws(() => rustTypeFromCarrierInContext({ ...rustProgramErrorTargetType(),
    genericArguments: [{ kind: "type", type: rustProgramErrorTargetType() }] }, context("owner", "project")),
  error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT");
});
