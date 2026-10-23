import assert from "node:assert/strict";
import test from "node:test";
import { rustSourcePackageReferenceScope } from "../../../../dist/backend/planner/program/source-package-components.js";
import { qualifyRustReferenceType } from "../../../../dist/backend/target-ast/syntax/type-paths.js";

function context(componentId, errorDomain, programModuleName) {
  const component = Object.freeze({ componentId, errorDomain, programModuleName });
  const components = Object.freeze([component]);
  return { sourcePackageComponentId: componentId,
    input: { program: { records: { sourcePackageComponents: Object.freeze({ get: () => components }) } } } };
}

for (const [name, errorDomain, expected] of [
  ["runtime", "runtime", "tsonic_rust_runtime"],
  ["project", "project", "selected_native_library::closed_errors"],
]) {
  test(`native ${name} references use their actual selected binary scope`, () => {
    const scope = rustSourcePackageReferenceScope(context("root", errorDomain, "closed_errors"), "selected_native_library");
    assert.equal(scope.get("crate"), "selected_native_library", "only the selected library crate is relocated");
    assert.equal(scope.get("rt"), expected, "the component's real error-domain binding is preserved");
    assert.equal(scope.get("js_abi"), "tsonic_rust_js::abi", "the native JS ABI uses its declared crate path");
    assert.equal(scope.get("js_string"), "tsonic_rust_js::string", "the native string binding is preserved");
    assert.equal(scope.get("js_exact_string"), "tsonic_rust_js::exact_string", "the exact native string binding is preserved");
    const error = { kind: "named", path: "rt::TsonicError", identity: `${name}-error` };
    const relocated = qualifyRustReferenceType(error, scope);
    assert.equal(relocated.path, `${expected}::TsonicError`, "the binary has no unbound library alias");
    assert.equal(relocated.identity, error.identity, "syntax relocation does not select another semantic error");
  });
}

test("native dependency worker references remain in their own component domain", () => {
  const scope = rustSourcePackageReferenceScope(context("dependency", "project", "dependency_errors"), "dependency_alias");
  const selected = qualifyRustReferenceType({ kind: "named", path: "crate::InitializationErrors",
    identity: "dependency-initializer", genericArguments: [{ kind: "type", type: {
      kind: "named", path: "rt::TsonicError", identity: "dependency-error" } }, { kind: "type", type: {
      kind: "named", path: "foreign_alias::Failure", identity: "foreign-error" } }] }, scope);
  assert.equal(selected.path, "dependency_alias::InitializationErrors", "the worker uses the actual dependency crate alias");
  assert.equal(selected.genericArguments[0].type.path, "dependency_alias::dependency_errors::TsonicError", "the dependency error is not rebound to the root");
  assert.equal(selected.genericArguments[1].type.path, "foreign_alias::Failure", "the authored foreign dependency alias stays intact");
  assert.equal(selected.genericArguments[0].type.identity, "dependency-error", "the exact dependency native identity is unchanged");
});

test("native reference scope refuses a missing sealed component as an internal invariant", () => {
  const invalid = context("root", "project", "program");
  assert.throws(() => rustSourcePackageReferenceScope({ ...invalid, sourcePackageComponentId: "missing" }, "selected_native_library"),
    failure => failure?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT",
    "a missing sealed native binding environment is never guessed from source names");
});
