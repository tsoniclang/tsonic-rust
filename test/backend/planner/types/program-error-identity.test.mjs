import assert from "node:assert/strict";
import test from "node:test";
import { rustTypeFromCarrier, rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustProgramErrorTargetType, rustVecTargetType } from "../../../../dist/target-model/types/index.js";
import { rustRuntimeErrorTypeIdentity, rustSourcePackageErrorTypeIdentity } from "../../../../dist/backend/planner/program/source-package-errors.js";
import { rustTypeEquals } from "../../../../dist/backend/target-ast/inspection/type-equality.js";

function context(componentId, errorDomain) {
  return { usedAliases: new Set(), sourcePackageComponentId: componentId,
    sourcePackageErrors: { domainsByComponentId: new Map([[componentId, { componentId, errorDomain,
      errorTypeIdentity: rustSourcePackageErrorTypeIdentity(componentId, errorDomain) }]]) } };
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

test("program error rendering fails closed without its selected domain or with malformed arity", () => {
  const scope = context("owner", "project");
  scope.sourcePackageErrors.domainsByComponentId.clear();
  assert.equal(rustTypeFromCarrierInContext(rustProgramErrorTargetType(), scope) === undefined, true);
  assert.equal(rustTypeFromCarrierInContext(rustProgramErrorTargetType(), {}) === undefined, true);
  assert.equal(rustTypeFromCarrier(rustProgramErrorTargetType()) === undefined, true);
  assert.equal(rustTypeFromCarrierInContext({ ...rustProgramErrorTargetType(),
    genericArguments: [{ kind: "type", type: rustProgramErrorTargetType() }] }, context("owner", "project")) === undefined, true);
});
