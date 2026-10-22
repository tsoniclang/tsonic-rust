import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorTransportFixture, rustErrorDomainFixture } from "../../helpers/error-transport.mjs";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustProgramErrorConversion } from "../../../dist/policy/conversions/program-error.js";

const closedValue = (records, target, component = "root", identity = "root:error") =>
  records.programErrorClosedValue.get(component, identity, target);

test("runtime error domains select the native Error admission for each closed destination", () => {
  const fixture = rustErrorDomainFixture("runtime");
  const { records, issues } = analyzeRustErrorTransportFixture(fixture);
  assert.deepEqual(issues, []);
  for (const [target, ownerPath] of [[rustTsValueTargetType(), "rt::TsValue"], [rustJsValueTargetType(), "js_abi::JsValue"]]) {
    assert.deepEqual(closedValue(records, target), { kind: "selected", ownerPath, value: { kind: "runtime" } });
  }
});

test("project error domains seal every transport variant with its exact payload admission", () => {
  for (const [target, closed] of [[rustTsValueTargetType(), "ClosedNative"], [rustJsValueTargetType(), "ClosedJs"]]) {
    const fixture = rustErrorDomainFixture("project", [target], true);
    const { records, issues } = analyzeRustErrorTransportFixture(fixture);
    assert.deepEqual(issues, []);
    assert.deepEqual(records.programErrorVariants.get("root").map(variant => variant.name), [closed, "Retained"]);
    const selected = closedValue(records, target);
    assert.equal(selected.kind, "selected");
    assert.equal(selected.value.kind, "domain");
    assert.equal(selected.value.path, "rt::TsonicError");
    assert.deepEqual(selected.value.arms.map(arm => [arm.name, arm.payload.kind]), [
      ["Runtime", "error"], ["SourceCreated", "error"], [closed, "value"], ["Retained", "error"], ["Suppressed", "suppressed"],
    ]);
    assert.equal(selected.value.arms.find(arm => arm.name === closed).payload.conversion, null,
      "a same-carrier payload is moved without a conversion");
    assert.ok(Object.isFrozen(selected) && Object.isFrozen(selected.value.arms) && selected.value.arms.every(Object.isFrozen));
  }
});

test("a forwarding component selects the owner inventory and rejects a missing or different owner", () => {
  const target = rustTsValueTargetType();
  const forwardingFixture = () => {
    const fixture = rustErrorDomainFixture("project", [target], true);
    const forwarding = fixture.errors.domainsByComponentId.get("root");
    const owner = { ...forwarding, componentId: "owner", errorOwnerComponentId: "owner", externalErrors: [] };
    forwarding.errorOwnerComponentId = "owner";
    forwarding.forwardModulePath = "owner_crate::program";
    forwarding.externalErrors.push({ componentId: "owner", errorOwnerComponentId: "owner",
      crateName: "owner_crate", typePath: "owner_crate::program::TsonicError", variant: "OwnerError" });
    fixture.errors.domainsByComponentId.set("owner", owner);
    const demand = fixture.program.sourcePackageComponents.forComponent("owner");
    fixture.program.sourcePackageComponents.forComponent = component => component === "owner" ? demand : undefined;
    return { fixture, owner };
  };
  const { fixture } = forwardingFixture();
  const { records, issues } = analyzeRustErrorTransportFixture(fixture);
  assert.deepEqual(issues, []);
  assert.equal(records.programErrorVariants.get("root"), undefined, "the forwarding component owns no inventory");
  const selected = closedValue(records, target);
  assert.equal(selected.kind, "selected");
  assert.deepEqual(selected.value.arms.map(arm => arm.name), ["Runtime", "SourceCreated", "ClosedNative", "Retained", "Suppressed"]);
  for (const mutate of [
    (current) => current.fixture.errors.domainsByComponentId.delete("owner"),
    (current) => { current.owner.errorTypeIdentity = "unrelated:error"; },
  ]) {
    const current = forwardingFixture();
    mutate(current);
    const rejected = analyzeRustErrorTransportFixture(current.fixture);
    assert.deepEqual(rejected.issues, []);
    const value = closedValue(rejected.records, target);
    assert.equal(value.kind, "rejected");
    assert.match(value.reason, /no exact sealed transport variant inventory/u);
  }
});

test("external transport payloads nest the dependency domain without a wrapper value", () => {
  const target = rustTsValueTargetType();
  const external = { componentId: "dependency", errorOwnerComponentId: "dependency", crateName: "dependency_crate",
    typePath: "dependency_crate::program::TsonicError", variant: "DependencyError" };
  const fixture = rustErrorDomainFixture("project", [], true, [external]);
  fixture.errors.domainsByComponentId.set("dependency", { componentId: "dependency", errorOwnerComponentId: "dependency",
    errorDomain: "project", errorTypeIdentity: "dependency:error", definitions: [], externalErrors: [] });
  fixture.errors.dependencyErrorsByComponentId.set("dependency", []);
  fixture.program.sourcePackageComponents.forComponent = component => ({ closedErrorDemand: {
    thrownCarriers: component === "dependency" ? [target] : [], retained: component === "dependency", sourceView: false } });
  const { records, issues } = analyzeRustErrorTransportFixture(fixture);
  assert.deepEqual(issues, []);
  const selected = closedValue(records, target);
  assert.equal(selected.kind, "selected");
  const nested = selected.value.arms.find(arm => arm.name === "DependencyError");
  assert.equal(nested.payload.kind, "external");
  assert.equal(nested.payload.value.kind, "domain");
  assert.equal(nested.payload.value.path, "dependency_crate::program::TsonicError");
  const closed = nested.payload.value.arms.find(arm => arm.name === "ClosedNative");
  assert.deepEqual(closed.payload, { kind: "value", conversion: null });
});

test("transport inventories reject unsupported carriers and duplicate or reserved variant identities", () => {
  for (const [mutate, code] of [
    [fixture => { fixture.program.sourcePackageComponents.forComponent = () => ({
      closedErrorDemand: { thrownCarriers: [{ kind: "target-named", id: "foreign.closed" }], retained: true, sourceView: false } }); },
      "RUST_ERROR_TRANSPORT_UNRESOLVED"],
    [fixture => fixture.errors.domainsByComponentId.get("root").externalErrors.push({ componentId: "dependency",
      errorOwnerComponentId: "dependency", crateName: "dependency_crate", typePath: "dependency_crate::program::TsonicError",
      variant: "Runtime" }), "RUST_CLOSED_ERROR_DEMAND_MISSING"],
    [fixture => fixture.errors.domainsByComponentId.get("root").externalErrors.push({ componentId: "dependency",
      errorOwnerComponentId: "dependency", crateName: "dependency_crate", typePath: "dependency_crate::program::TsonicError",
      variant: "ClosedNative" }), "RUST_CLOSED_ERROR_DEMAND_MISSING"],
  ]) {
    const fixture = rustErrorDomainFixture("project", [rustTsValueTargetType()]);
    mutate(fixture);
    const { records, issues } = analyzeRustErrorTransportFixture(fixture);
    assert.deepEqual(issues.map(issue => issue.code), [code]);
    assert.equal(records.programErrorVariants.get("root"), undefined);
    assert.equal(closedValue(records, rustTsValueTargetType()), undefined);
  }
});

test("missing and cyclic component evidence fails closed without a partial value", () => {
  const target = rustTsValueTargetType();
  const missing = rustErrorDomainFixture("project");
  missing.errors.domainsByComponentId.clear();
  const withoutDomains = analyzeRustErrorTransportFixture(missing);
  assert.deepEqual(withoutDomains.issues, []);
  assert.equal(withoutDomains.records.sourcePackageErrorBoundary.get("root", "root"), undefined);
  assert.equal(closedValue(withoutDomains.records, target), undefined);
  const undemanded = rustErrorDomainFixture("project");
  undemanded.program.sourcePackageComponents.forComponent = () => undefined;
  assert.deepEqual(analyzeRustErrorTransportFixture(undemanded).issues.map(issue => issue.code), ["RUST_CLOSED_ERROR_DEMAND_MISSING"]);
  const cyclic = rustErrorDomainFixture("project");
  cyclic.errors.domainsByComponentId.get("root").externalErrors.push({ componentId: "root", errorOwnerComponentId: "root",
    typePath: "rt::TsonicError", variant: "External", crateName: "root" });
  const { records, issues } = analyzeRustErrorTransportFixture(cyclic);
  assert.deepEqual(issues, []);
  const value = closedValue(records, target);
  assert.equal(value.kind, "rejected");
  assert.match(value.reason, /bounded acyclic component graph/u);
});

test("unproved cross-carrier admission is rejected instead of a passive or lossy fallback", () => {
  const { records, issues } = analyzeRustErrorTransportFixture(rustErrorDomainFixture("project", [rustTsValueTargetType()], true));
  assert.deepEqual(issues, []);
  assert.equal(closedValue(records, rustTsValueTargetType()).kind, "selected");
  const value = closedValue(records, rustJsValueTargetType());
  assert.equal(value.kind, "rejected");
  assert.match(value.reason, /exact infallible conversion/u);
});

test("deep component evidence remains bounded without producing a partial value", () => {
  const fixture = rustErrorDomainFixture("project", [], true);
  for (let index = 0; index < 256; index++) {
    const owner = index === 0 ? "root" : `dependency${index}`;
    const dependencyId = `dependency${index + 1}`;
    const external = { componentId: dependencyId, errorOwnerComponentId: dependencyId, crateName: dependencyId,
      typePath: `${dependencyId}::program::TsonicError`, variant: "Next" };
    fixture.errors.domainsByComponentId.get(owner).externalErrors.push(external);
    fixture.errors.dependencyErrorsByComponentId.set(owner, [external]);
    fixture.errors.domainsByComponentId.set(dependencyId, { componentId: dependencyId, errorOwnerComponentId: dependencyId,
      errorDomain: "project", errorTypeIdentity: `${dependencyId}:error`, definitions: [], externalErrors: [] });
  }
  const { records, issues } = analyzeRustErrorTransportFixture(fixture);
  assert.deepEqual(issues, []);
  const value = closedValue(records, rustTsValueTargetType());
  assert.equal(value.kind, "rejected");
  assert.match(value.reason, /bounded acyclic component graph/u);
});

test("a closed thrown value outside a project error domain is refused before planning", () => {
  const thrown = { kind: "KindThrowStatement" };
  const throwOperation = target => ({ targetOperation: { get: node => node === thrown
    ? { kind: "throw-op", operationId: "tsonic.rust.error.throw",
      error: { kind: "conversion", expression: {}, conversion: selectRustProgramErrorConversion(target) } } : undefined } });
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const runtime = analyzeRustErrorTransportFixture(rustErrorDomainFixture("runtime"),
      { nodes: [thrown], records: throwOperation(target) });
    assert.deepEqual(runtime.issues.map(({ code, message }) => ({ code, message })), [{
      code: "RUST_MISSING_TARGET_FACT",
      message: "Closed thrown values require their own sealed source-package payload transport. Node kind: KindThrowStatement.",
    }], "the user-visible refusal is an analysis diagnostic, not a planner invariant");
    const project = analyzeRustErrorTransportFixture(rustErrorDomainFixture("project", [target], true),
      { nodes: [thrown], records: throwOperation(target) });
    assert.deepEqual(project.issues, [], "the own project domain transports the closed value");
  }
});
