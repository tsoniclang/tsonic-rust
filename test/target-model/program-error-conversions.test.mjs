import { assertNoTargetDiagnostics } from "../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { rustProgramErrorConversionMatches } from "../../dist/target-model/conversions/program-error.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType,
  rustSourceTypeCarrier } from "../../dist/target-model/types/index.js";
import { selectRustValueCarrierReconciliation } from "../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustProgramErrorConstruction } from "../../dist/backend/planner/expressions/program-errors.js";
import { collectRustDeclaredProviderErrorCarriers, analyzeRustProviderErrorCarriers } from "../../dist/analysis/program/provider-errors.js";
import { rustTargetOperationFactKey } from "../../dist/analysis/facts/keys.js";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";

const source = rustSourceTypeCarrier("/failure.ts", "Failure", "object");
const target = rustProgramErrorTargetType();
const definition = {};
const registry = createRustTypeDefinitionRegistry();
assert.equal(registry.registerProgramErrorOrigin(source, { kind: "project", variant: "Failure", sourceError: false }), true);
const definitions = registry.seal();
const policy = {
  definitionForCarrier: carrier => carrier === source ? definition : undefined,
  programErrorVariant: current => current === definition ? "Failure" : undefined,
  openCarrier: () => source,
};

test("program-error construction retains its exact class, variant and native payload", () => {
  const selected = selectRustValueCarrierReconciliation(source, target, policy, definitions);
  assert.equal(selected.kind, "conversion");
  const conversion = selected.fact.conversion;
  assert.equal(rustProgramErrorConversionMatches(conversion, source, target, definitions), true);
  assert.equal(rustProgramErrorConversionMatches(conversion, source, target), false, "unregistered project origin");
  for (const changed of [
    { ...conversion, source: target }, { ...conversion, target: source },
    { ...conversion, route: { kind: "project", variant: "" } },
    { ...conversion, route: { kind: "project", variant: null } },
    { ...conversion, route: undefined }, { ...conversion, variant: "Failure" },
    { kind: "program-error", source, target, variant: "Failure" },
  ]) assert.equal(rustProgramErrorConversionMatches(changed, source, target, definitions), false);
  const builtin = rustJsErrorTargetType();
  assert.equal(rustProgramErrorConversionMatches(
    { kind: "program-error", source: builtin, target, route: { kind: "runtime", boundary: "target-runtime" } }, builtin, target), true);
  assert.equal(rustProgramErrorConversionMatches(
    { kind: "program-error", source: builtin, target, route: { kind: "project", variant: "Failure" } }, builtin, target), false);
  for (const invalid of [rustSourcePrimitiveTargetType("uint64"), rustSourceTypeCarrier("/failure.ts", "Code", "enum")]) {
    assert.equal(rustProgramErrorConversionMatches(
      { kind: "program-error", source: invalid, target, route: { kind: "project", variant: "Failure" } }, invalid, target), false);
  }
});

test("program-error emission rejects stale variants and unrelated source-package routes", () => {
  const boundary = { componentId: "root", errorDomain: "program", errorTypePath: "rt::TsonicError" };
  const value = { kind: "identifier", name: "original" };
  for (const variant of ["Failure", "Changed"]) {
    for (const owner of ["root", "unrelated"]) {
      const context = {
        diagnostics: [], usedAliases: new Set(),
        input: { program: { projectTypes: policy, typeDefinitions: definitions, source: { ast: {
          getFileName: () => "/failure.ts", getSourceText: () => "", pos: () => 0, end: () => 0,
          kindName: () => "KindIdentifier",
        } } } },
        sourcePackageErrors: {
          componentIdByDefinition: new Map([[definition, owner]]),
          domainsByComponentId: new Map([["root", { definitions: [definition], externalErrors: [] }]]),
          dependencyErrorsByComponentId: new Map(),
        },
      };
      const result = planRustProgramErrorConstruction({ kind: "program-error", source, target, route: { kind: "project", variant } },
        value, undefined, context, boundary);
      if (variant === "Failure" && owner === "root") {
        assert.deepEqual(result, { kind: "call", path: "rt::TsonicError::Failure", args: [value] });
        assertNoTargetDiagnostics(context.diagnostics);
      } else {
        assert.equal(result, undefined);
        assert.equal(context.diagnostics.length, 1);
      }
    }
  }
});

test("runtime error emission requires an exact registered carrier and selected boundary", () => {
  const native = { kind: "target-named", id: "example.NativeFailure" };
  const unrelated = { kind: "target-named", id: "example.UnrelatedFailure" };
  const builtin = rustJsErrorTargetType();
  const boundary = { componentId: "root", errorDomain: "runtime", errorTypePath: "rt::TsonicError" };
  const value = { kind: "identifier", name: "original" };
  for (const [carrier, registered, selectedBoundary, accepted] of [
    [native, [native], "provider-native", true],
    [native, [], "provider-native", false],
    [native, [unrelated], "provider-native", false],
    [native, [native], "target-runtime", false],
    [native, [native], "source-program", false],
    [builtin, [], "target-runtime", true],
    [builtin, [builtin], "provider-native", false],
  ]) {
    const registry = createRustTypeDefinitionRegistry();
    for (const registeredCarrier of registered) {
      assert.equal(registry.registerProgramErrorOrigin(registeredCarrier, { kind: "provider" }), true);
    }
    const context = { diagnostics: [], usedAliases: new Set(), input: { program: {
      providerErrorCarriers: registered, typeDefinitions: registry.seal(), source: { ast: {
        getFileName: () => "/failure.ts", getSourceText: () => "", pos: () => 0, end: () => 0,
        kindName: () => "KindIdentifier",
      } },
    } } };
    const result = planRustProgramErrorConstruction({ kind: "program-error", source: carrier, target,
      route: { kind: "runtime", boundary: selectedBoundary } }, value, undefined, context, boundary);
    if (accepted) {
      assert.deepEqual(result, { kind: "call", path: "rt::TsonicError::from", args: [value] });
      assertNoTargetDiagnostics(context.diagnostics);
    } else {
      assert.equal(result, undefined);
      assert.equal(context.diagnostics.length, 1);
    }
  }
});

test("native throw carriers are declared once and transported by the used-error owner", () => {
  const native = { kind: "target-named", id: "example.NativeFailure" };
  const other = { kind: "target-named", id: "example.OtherFailure" };
  const declared = collectRustDeclaredProviderErrorCarriers([
    { target: { form: "function" }, isFallible: true, errorBoundary: "provider-native", errorCarrier: native },
    { target: { form: "function" }, isFallible: true, errorBoundary: "provider-native", errorCarrier: { ...native } },
    { target: { form: "function" }, isFallible: true, errorBoundary: "target-runtime" },
    { target: { form: "function" }, isFallible: false, errorCarrier: other },
    { target: { form: "source-module-construction", bootstrap: { errorBoundary: "provider-native", errorCarrier: other } } },
  ], [
    { isFallible: true, errorBoundary: "provider-native", errorCarrier: { ...other } },
    { isFallible: true, errorBoundary: "target-runtime" },
  ]);
  assert.deepEqual(declared, [native, other]);
  assert.ok(Object.isFrozen(declared));
  const statement = {};
  const error = { kind: "conversion", expression: {}, conversion: { kind: "program-error", source: native,
    target, route: { kind: "runtime", boundary: "provider-native" } } };
  const ast = { forEachChild() {} };
  for (const [selected, expected] of [
    [error, [native]], [{ ...error, conversion: { ...error.conversion, route: { kind: "runtime", boundary: "target-runtime" } } }, []],
    [{ kind: "program", expression: {}, carrier: target }, []],
  ]) {
    const used = analyzeRustProviderErrorCarriers(ast, [statement], {
      getFact: (node, key) => node === statement && key === rustTargetOperationFactKey
        ? { kind: "throw-op", error: selected } : undefined,
    }, []);
    assert.deepEqual(used, expected);
    assert.ok(Object.isFrozen(used));
  }
});

test("source-program native errors enter inventory only through selected operation evidence", () => {
  const native = { kind: "target-named", id: "example.NativeFailure" };
  const declared = collectRustDeclaredProviderErrorCarriers([
    { target: { form: "call" }, isFallible: true, errorBoundary: "source-program", nativeErrorCarriers: [native] },
    { target: { form: "call" }, isFallible: true, errorBoundary: "source-program", nativeErrorCarriers: [{ ...native }] },
  ], []);
  assert.deepEqual(declared, [native]);
  const statement = {};
  for (const [selected, expected] of [[undefined, []],
    [{ kind: "provider-operation", abi: { target: { form: "call" }, effects: { nativeErrorCarriers: [native] } } }, [native]],
    [{ kind: "provider-operation", abi: { target: { form: "call" }, effects: {} } }, []]]) {
    const used = analyzeRustProviderErrorCarriers({ forEachChild() {} }, [statement], {
      getFact: (node, key) => node === statement && key === rustTargetOperationFactKey ? selected : undefined,
    }, []);
    assert.deepEqual(used, expected);
    assert.equal(Object.isFrozen(used), true);
  }
});
