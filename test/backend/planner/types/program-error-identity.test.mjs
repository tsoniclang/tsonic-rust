import assert from "node:assert/strict";
import test from "node:test";
import { rustTypeFromCarrier, rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustProgramErrorTargetType, rustVecTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourcePackageErrorTypeIdentity } from "../../../../dist/backend/planner/program/source-package-errors.js";
import { rustRuntimeErrorTypeIdentity } from "../../../../dist/target-model/operations/error-boundary.js";
import { rustTypeEquals } from "../../../../dist/backend/target-ast/inspection/type-equality.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

function context(componentId, errorDomain) {
  return { usedAliases: new Set(), sourcePackageComponentId: componentId,
    input: { program: { typeDefinitions: emptyRustTypeDefinitions } },
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
  const scope = context("owner", "project");
  scope.sourcePackageErrors.domainsByComponentId.clear();
  assert.equal(rustTypeFromCarrierInContext(rustProgramErrorTargetType(), scope) === undefined, true);
  assert.equal(rustTypeFromCarrierInContext(rustProgramErrorTargetType(), {
    input: { program: { typeDefinitions: emptyRustTypeDefinitions } },
  }) === undefined, true);
  assert.equal(rustTypeFromCarrier(rustProgramErrorTargetType()) === undefined, true);
  assert.equal(rustTypeFromCarrierInContext({ ...rustProgramErrorTargetType(),
    genericArguments: [{ kind: "type", type: rustProgramErrorTargetType() }] }, context("owner", "project")) === undefined, true);
});
