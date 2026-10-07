import assert from "node:assert/strict";
import test from "node:test";
import { planRustProgramErrorClosedValue } from "../../../../dist/backend/planner/expressions/program-error-values.js";
import { planRustErrorVariants } from "../../../../dist/backend/planner/program/error-variants.js";
import { analyzeRustErrorTransport } from "../../../../dist/analysis/program/error-transport.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../../dist/target-model/types/index.js";

function context(errorDomain, thrownCarriers = [], retained = false, external = []) {
  const domain = { componentId: "root", errorOwnerComponentId: errorDomain === "project" ? "root" : undefined,
    errorDomain, errorTypeIdentity: "root:error", definitions: [], externalErrors: external };
  return {
    sourceFile: { kind: "KindSourceFile" },
    sourcePackageComponentId: "root",
    diagnostics: [],
    usedAliases: new Set(),
    syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() },
    sourcePackageErrors: { domainsByComponentId: new Map([["root", domain]]),
      dependencyErrorsByComponentId: new Map([["root", external]]) },
    input: { program: {
      projectTypes: { programErrorDefinitions: [], sourceErrorDefinitions: [], programErrorVariant: () => undefined },
      typeDefinitions: emptyRustTypeDefinitions,
      errorStorageDemands: { retainedBoundaries: [] },
      sourcePackageComponents: { forComponent: () => ({ closedErrorDemand: { thrownCarriers, retained } }) },
      source: { ast: { kindName: node => node.kind, pos: () => 0, end: () => 0,
        getFileName: () => "/src/index.ts", getSourceText: () => "" } },
    } },
  };
}

function seal(input) {
  const program = input.input.program;
  const components = [...input.sourcePackageErrors.domainsByComponentId.values()].flatMap(domain => {
    const selected = program.sourcePackageComponents.forComponent(domain.componentId);
    return selected === undefined ? [] : [{ ...domain, closedErrorDemand: selected.closedErrorDemand }];
  });
  const result = analyzeRustErrorTransport({
    ...program, ast: program.source.ast,
    sourcePackageComponents: {
      components,
      componentForFile: () => components[0],
    },
  });
  program.errorTransport = result.kind === "resolved" ? result.value : undefined;
}

test("runtime transport uses native Error admission without copying, projection probes or boxing", () => {
  const source = { kind: "path", path: "original" };
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const input = context("runtime");
    seal(input);
    const result = planRustProgramErrorClosedValue(source, target, undefined, input);
    assert.equal(result !== undefined, true, target.id);
    assert.equal(result.kind, "call");
    assert.equal(result.path, target.id === rustTsValueTargetType().id
      ? "rt::TsValue::from_error" : "js_abi::JsValue::from_error");
    assert.equal(result.args[0] === source, true);
    assert.equal(input.diagnostics.length, 0);
  }
});

test("project transport exhaustively preserves same-carrier payloads and Error categories", () => {
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const input = context("project", [target], true);
    seal(input);
    const selected = planRustErrorVariants(input.input.program,
      input.sourcePackageErrors.domainsByComponentId.get("root"));
    assert.deepEqual(selected.map(variant => variant.name),
      [target.id === rustTsValueTargetType().id ? "ClosedNative" : "ClosedJs", "Retained"]);
    assert.equal(Object.isFrozen(selected) && selected.every(Object.isFrozen), true);
    const source = { kind: "path", path: "original" };
    seal(input);
    const result = planRustProgramErrorClosedValue(source, target, undefined, input);
    assert.equal(result !== undefined, true, target.id);
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
    assert.equal(input.diagnostics.length, 0);
  }
});

test("program carrier admission uses its component-owned value domain, not an outward propagation ABI", () => {
  const input = context("project", [rustTsValueTargetType()], true);
  input.fallibleBoundary = { componentId: "unrelated", errorDomain: "project",
    errorTypePath: "unrelated_crate::program::TsonicError", errorTypeIdentity: "unrelated:error" };
  seal(input);
  const result = planRustProgramErrorClosedValue({ kind: "path", path: "original" },
    rustTsValueTargetType(), undefined, input);
  assert.equal(result !== undefined, true);
  assert.equal(result.kind, "match");
  assert.equal(result.arms.every(arm => arm.pattern.path.startsWith("rt::TsonicError::")), true);
  assert.equal(input.diagnostics.length, 0);
});

test("a forwarding component projects the exact owner inventory through the public alias", () => {
  const target = rustTsValueTargetType();
  const input = context("project", [target], true);
  const forwarding = input.sourcePackageErrors.domainsByComponentId.get("root");
  const owner = { ...forwarding, componentId: "owner", errorOwnerComponentId: "owner", externalErrors: [] };
  forwarding.errorOwnerComponentId = "owner";
  forwarding.forwardModulePath = "owner_crate::program";
  forwarding.externalErrors.push({ componentId: "owner", errorOwnerComponentId: "owner",
    crateName: "owner_crate", typePath: "owner_crate::program::TsonicError", variant: "OwnerError" });
  input.sourcePackageErrors.domainsByComponentId.set("owner", owner);
  const ownerDemand = input.input.program.sourcePackageComponents.forComponent("owner");
  input.input.program.sourcePackageComponents.forComponent = component => component === "owner" ? ownerDemand : undefined;
  seal(input);
  assert.equal(planRustErrorVariants(input.input.program, forwarding) === undefined, true);
  const source = { kind: "path", path: "original" };
  seal(input);
  const result = planRustProgramErrorClosedValue(source, target, undefined, input);
  assert.equal(result !== undefined, true);
  assert.equal(result.kind, "match");
  assert.equal(result.expression === source, true);
  assert.deepEqual(result.arms.map(arm => arm.pattern.path), [
    "rt::TsonicError::Runtime", "rt::TsonicError::SourceCreated", "rt::TsonicError::ClosedNative",
    "rt::TsonicError::Retained", "rt::TsonicError::Suppressed",
  ]);
  assert.equal(input.diagnostics.length, 0);
  for (const mutate of [
    () => input.sourcePackageErrors.domainsByComponentId.delete("owner"),
    () => { owner.errorTypeIdentity = "unrelated:error"; },
  ]) {
    input.sourcePackageErrors.domainsByComponentId.set("owner", owner);
    owner.errorTypeIdentity = forwarding.errorTypeIdentity;
    mutate();
    seal(input);
    assert.equal(planRustProgramErrorClosedValue(source, target, undefined, input) === undefined, true);
  }
  assert.equal(input.diagnostics.length, 2);
});

test("external transport projection moves its exact nested payload without a wrapper value", () => {
  const target = rustTsValueTargetType();
  const external = { componentId: "dependency", errorOwnerComponentId: "dependency", crateName: "dependency_crate",
    typePath: "dependency_crate::program::TsonicError", variant: "DependencyError" };
  const input = context("project", [], true, [external]);
  const dependency = { componentId: "dependency", errorOwnerComponentId: "dependency", errorDomain: "project",
    errorTypeIdentity: "dependency:error", definitions: [], externalErrors: [] };
  input.sourcePackageErrors.domainsByComponentId.set("dependency", dependency);
  input.sourcePackageErrors.dependencyErrorsByComponentId.set("dependency", []);
  input.input.program.sourcePackageComponents.forComponent = component => ({
    closedErrorDemand: { thrownCarriers: component === "dependency" ? [target] : [], retained: component === "dependency" },
  });
  const source = { kind: "path", path: "original" };
  seal(input);
  const result = planRustProgramErrorClosedValue(source, target, undefined, input);
  assert.equal(result !== undefined, true);
  assert.equal(result.expression === source, true);
  const nested = result.arms.find(arm => arm.pattern.path === "rt::TsonicError::DependencyError");
  assert.equal(nested !== undefined, true);
  assert.equal(nested.expression.kind, "match");
  assert.equal(nested.expression.expression.path, nested.pattern.elements[0].name);
  const closed = nested.expression.arms.find(arm => arm.pattern.path === "dependency_crate::program::TsonicError::ClosedNative");
  assert.equal(closed !== undefined, true);
  assert.equal(closed.expression.kind, "path");
  assert.equal(closed.expression.path, closed.pattern.elements[0].name);
  assert.equal(input.diagnostics.length, 0);
});

test("sealed transport inventory rejects unsupported carriers and duplicate native variant identities", () => {
  for (const mutate of [
    input => { input.input.program.sourcePackageComponents.forComponent = () => ({
      closedErrorDemand: { thrownCarriers: [{ kind: "target-named", id: "foreign.closed" }], retained: true },
    }); },
    input => {
      const external = { componentId: "dependency", errorOwnerComponentId: "dependency", crateName: "dependency_crate",
        typePath: "dependency_crate::program::TsonicError", variant: "Runtime" };
      input.sourcePackageErrors.domainsByComponentId.get("root").externalErrors.push(external);
    },
    input => {
      const external = { componentId: "dependency", errorOwnerComponentId: "dependency", crateName: "dependency_crate",
        typePath: "dependency_crate::program::TsonicError", variant: "ClosedNative" };
      input.sourcePackageErrors.domainsByComponentId.get("root").externalErrors.push(external);
    },
  ]) {
    const input = context("project", [rustTsValueTargetType()]);
    mutate(input);
    seal(input);
    assert.equal(planRustErrorVariants(input.input.program,
      input.sourcePackageErrors.domainsByComponentId.get("root")) === undefined, true);
    seal(input);
    assert.equal(planRustProgramErrorClosedValue({ kind: "path", path: "original" },
      rustTsValueTargetType(), undefined, input) === undefined, true);
    assert.equal(input.diagnostics.length, 1);
  }
});

test("missing and cyclic component evidence fails closed without boxing a transport", () => {
  const source = { kind: "path", path: "original" };
  for (const mutate of [
    input => input.sourcePackageErrors.domainsByComponentId.clear(),
    input => { input.input.program.sourcePackageComponents.forComponent = () => undefined; },
    input => {
      const external = { componentId: "root", errorOwnerComponentId: "root", typePath: "rt::TsonicError",
        variant: "External", crateName: "root" };
      input.sourcePackageErrors.domainsByComponentId.get("root").externalErrors.push(external);
    },
  ]) {
    const input = context("project");
    mutate(input);
    seal(input);
    assert.equal(planRustProgramErrorClosedValue(source, rustTsValueTargetType(), undefined, input) === undefined, true);
    assert.equal(input.diagnostics.length, 1);
    assert.equal(input.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
  }
});

test("unproved cross-carrier admission is not a passive or lossy fallback", () => {
  const input = context("project", [rustTsValueTargetType()], true);
  seal(input);
  const result = planRustProgramErrorClosedValue({ kind: "path", path: "original" },
    rustJsValueTargetType(), undefined, input);
  assert.equal(result === undefined, true);
  assert.equal(input.diagnostics.length, 1);
  assert.equal(input.diagnostics[0].message.includes("exact infallible conversion"), true);
});

test("deep component evidence remains bounded without producing a partial value", () => {
  const input = context("project", [], true);
  for (let index = 0; index < 256; index++) {
    const owner = index === 0 ? "root" : `dependency${index}`;
    const dependencyId = `dependency${index + 1}`;
    const external = { componentId: dependencyId, errorOwnerComponentId: dependencyId, crateName: dependencyId,
      typePath: `${dependencyId}::program::TsonicError`, variant: "Next" };
    input.sourcePackageErrors.domainsByComponentId.get(owner).externalErrors.push(external);
    input.sourcePackageErrors.dependencyErrorsByComponentId.set(owner, [external]);
    input.sourcePackageErrors.domainsByComponentId.set(dependencyId, {
      componentId: dependencyId, errorOwnerComponentId: dependencyId, errorDomain: "project",
      errorTypeIdentity: `${dependencyId}:error`, definitions: [], externalErrors: [],
    });
  }
  seal(input);
  assert.equal(planRustProgramErrorClosedValue({ kind: "path", path: "original" },
    rustTsValueTargetType(), undefined, input) === undefined, true);
  assert.equal(input.diagnostics.length, 1);
  assert.equal(input.diagnostics[0].message.includes("bounded acyclic component graph"), true);
});
