import { rustCurrentErrorBoundary } from "../../../../dist/backend/planner/program/plan-context.js";
import assert from "node:assert/strict";
import test from "node:test";
import { rustPackageFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { planRustProgramErrorClosedValue } from "../../../../dist/backend/planner/expressions/program-error-values.js";
import { planRustErrorVariants } from "../../../../dist/backend/planner/program/error-variants.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustErrorTransportFixture, rustErrorDomainFixture } from "../../../helpers/error-transport.mjs";

// The planner context of the root component over the records the error-transport analysis owners sealed. The
// selection and refusal decisions are tested at those owners (test/analysis/errors/closed-error-values.test.mjs).
function sealed(fixture) {
  const { records, issues } = analyzeRustErrorTransportFixture(fixture);
  assert.deepEqual(issues, []);
  return {
    sourceFile: fixture.sourceFile, nativeHeaderPlacement: fixture.sourceFile, nativeHeaderParent: undefined,
    sourcePackageComponentId: "root",
    diagnostics: [],
    usedAliases: new Set(),
    syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() },
    sourcePackageErrors: fixture.errors,
    input: { program: { source: fixture.program.source, records } },
  };
}

const plan = (context, target, source = { kind: "path", path: "original" }) =>
  planRustProgramErrorClosedValue(source, target, undefined, context, rustCurrentErrorBoundary(context));

test("runtime transport uses native Error admission without copying, projection probes or boxing", () => {
  const source = { kind: "path", path: "original" };
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const context = sealed(rustErrorDomainFixture("runtime"));
    const result = plan(context, target, source);
    assert.equal(result.kind, "call");
    assert.equal(result.path, target.id === rustTsValueTargetType().id
      ? "rt::TsValue::from_error" : "js_abi::JsValue::from_error");
    assert.equal(result.args[0] === source, true);
    assert.equal(context.diagnostics.length, 0);
  }
});

test("project transport exhaustively preserves same-carrier payloads and Error categories", () => {
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const fixture = rustErrorDomainFixture("project", [target], true);
    const context = sealed(fixture);
    const selected = planRustErrorVariants(context.input.program, fixture.errors.domainsByComponentId.get("root"));
    assert.deepEqual(selected.map(variant => variant.name),
      [target.id === rustTsValueTargetType().id ? "ClosedNative" : "ClosedJs", "Retained"]);
    assert.equal(Object.isFrozen(selected) && selected.every(Object.isFrozen), true);
    const source = { kind: "path", path: "original" };
    const result = plan(context, target, source);
    assert.equal(result.kind, "match");
    assert.equal(result.expression === source, true);
    assert.deepEqual(result.arms.map(arm => arm.pattern.path.split("::").at(-1)),
      ["Runtime", "SourceCreated", ...selected.map(variant => variant.name), "Suppressed"]);
    for (const arm of result.arms) {
      const name = arm.pattern.path.split("::").at(-1);
      if (name === "ClosedNative" || name === "ClosedJs") {
        assert.equal(arm.expression.kind, "path");
        assert.equal(arm.expression.path, arm.pattern.elements[0].name);
      } else {
        assert.equal(arm.expression.kind, "call");
        assert.equal(arm.expression.path.endsWith("::from_error"), true, name);
      }
    }
    assert.equal(context.diagnostics.length, 0);
  }
});

test("program carrier admission uses its component-owned value domain, not an outward propagation ABI", () => {
  const context = sealed(rustErrorDomainFixture("project", [rustTsValueTargetType()], true));
  context.fallibleBoundary = rustPackageFallibleBoundary({ componentId: "unrelated", errorDomain: "project",
    errorTypePath: "unrelated_crate::program::TsonicError", errorTypeIdentity: "unrelated:error" });
  const result = plan(context, rustTsValueTargetType());
  assert.equal(result.kind, "match");
  assert.equal(result.arms.every(arm => arm.pattern.path.startsWith("rt::TsonicError::")), true);
  assert.equal(context.diagnostics.length, 0);
});

test("a forwarding component projects the exact owner inventory through the public alias", () => {
  const target = rustTsValueTargetType();
  const fixture = rustErrorDomainFixture("project", [target], true);
  const forwarding = fixture.errors.domainsByComponentId.get("root");
  const owner = { ...forwarding, componentId: "owner", errorOwnerComponentId: "owner", externalErrors: [] };
  forwarding.errorOwnerComponentId = "owner";
  forwarding.forwardModulePath = "owner_crate::program";
  forwarding.externalErrors.push({ componentId: "owner", errorOwnerComponentId: "owner",
    crateName: "owner_crate", typePath: "owner_crate::program::TsonicError", variant: "OwnerError" });
  fixture.errors.domainsByComponentId.set("owner", owner);
  const ownerDemand = fixture.program.sourcePackageComponents.forComponent("owner");
  fixture.program.sourcePackageComponents.forComponent = component => component === "owner" ? ownerDemand : undefined;
  const context = sealed(fixture);
  assert.equal(planRustErrorVariants(context.input.program, forwarding) === undefined, true);
  const source = { kind: "path", path: "original" };
  const result = plan(context, target, source);
  assert.equal(result.kind, "match");
  assert.equal(result.expression === source, true);
  assert.deepEqual(result.arms.map(arm => arm.pattern.path), [
    "rt::TsonicError::Runtime", "rt::TsonicError::SourceCreated", "rt::TsonicError::ClosedNative",
    "rt::TsonicError::Retained", "rt::TsonicError::Suppressed",
  ]);
  assert.equal(context.diagnostics.length, 0);
});

test("external transport projection moves its exact nested payload without a wrapper value", () => {
  const target = rustTsValueTargetType();
  const external = { componentId: "dependency", errorOwnerComponentId: "dependency", crateName: "dependency_crate",
    typePath: "dependency_crate::program::TsonicError", variant: "DependencyError" };
  const fixture = rustErrorDomainFixture("project", [], true, [external]);
  fixture.errors.domainsByComponentId.set("dependency", { componentId: "dependency", errorOwnerComponentId: "dependency",
    errorDomain: "project", errorTypeIdentity: "dependency:error", definitions: [], externalErrors: [] });
  fixture.errors.dependencyErrorsByComponentId.set("dependency", []);
  fixture.program.sourcePackageComponents.forComponent = component => ({
    closedErrorDemand: { thrownCarriers: component === "dependency" ? [target] : [], retained: component === "dependency", sourceView: false },
  });
  const context = sealed(fixture);
  const source = { kind: "path", path: "original" };
  const result = plan(context, target, source);
  assert.equal(result.expression === source, true);
  const nested = result.arms.find(arm => arm.pattern.path === "rt::TsonicError::DependencyError");
  assert.equal(nested !== undefined, true);
  assert.equal(nested.expression.kind, "match");
  assert.equal(nested.expression.expression.path, nested.pattern.elements[0].name);
  const closed = nested.expression.arms.find(arm => arm.pattern.path === "dependency_crate::program::TsonicError::ClosedNative");
  assert.equal(closed !== undefined, true);
  assert.equal(closed.expression.kind, "path");
  assert.equal(closed.expression.path, closed.pattern.elements[0].name);
  assert.equal(context.diagnostics.length, 0);
});

test("the planner refuses a closed value whose boundary or selection was not sealed", () => {
  const invariant = message => error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
    message.test(error.diagnostic.message);
  const missing = rustErrorDomainFixture("project");
  missing.errors.domainsByComponentId.clear();
  assert.throws(() => plan(sealed(missing), rustTsValueTargetType()), invariant(/exact native boundary/u));
  const cyclic = rustErrorDomainFixture("project");
  cyclic.errors.domainsByComponentId.get("root").externalErrors.push({ componentId: "root", errorOwnerComponentId: "root",
    typePath: "rt::TsonicError", variant: "External", crateName: "root" });
  assert.throws(() => plan(sealed(cyclic), rustTsValueTargetType()), invariant(/sealed native payload conversion tree/u));
  const crossCarrier = sealed(rustErrorDomainFixture("project", [rustTsValueTargetType()], true));
  assert.throws(() => plan(crossCarrier, rustJsValueTargetType()), invariant(/sealed native payload conversion tree/u));
});
