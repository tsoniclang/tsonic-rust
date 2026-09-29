import test from "node:test";
import assert from "node:assert/strict";
import { rustCompilerOwnedContextualConversionMatches } from "../../dist/target-model/conversions/contextual.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType,
  rustSourceTypeCarrier } from "../../dist/target-model/types/index.js";
import { selectRustValueCarrierReconciliation } from "../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustProgramErrorConstruction } from "../../dist/backend/planner/expressions/program-errors.js";

const source = rustSourceTypeCarrier("/failure.ts", "Failure", "object");
const target = rustProgramErrorTargetType();
const definition = {};
const policy = {
  definitionForCarrier: carrier => carrier === source ? definition : undefined,
  programErrorVariant: current => current === definition ? "Failure" : undefined,
  openCarrier: () => source,
};

test("program-error construction retains its exact class, variant and native payload", () => {
  const selected = selectRustValueCarrierReconciliation(source, target, policy);
  assert.equal(selected.kind, "conversion");
  const conversion = selected.fact.conversion;
  assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion), true);
  for (const changed of [
    { ...conversion, source: target }, { ...conversion, target: source },
    { ...conversion, variant: "" }, { ...conversion, variant: null }, { ...conversion, variant: undefined },
  ]) assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, changed), false);
  const builtin = rustJsErrorTargetType();
  assert.equal(rustCompilerOwnedContextualConversionMatches(builtin, target,
    { kind: "program-error", source: builtin, target }), true);
  assert.equal(rustCompilerOwnedContextualConversionMatches(builtin, target,
    { kind: "program-error", source: builtin, target, variant: "Failure" }), false);
  for (const invalid of [rustSourcePrimitiveTargetType("uint64"), rustSourceTypeCarrier("/failure.ts", "Code", "enum")]) {
    assert.equal(rustCompilerOwnedContextualConversionMatches(invalid, target,
      { kind: "program-error", source: invalid, target, variant: "Failure" }), false);
  }
});

test("program-error emission rejects stale variants and unrelated source-package routes", () => {
  const boundary = { componentId: "root", errorDomain: "program", errorTypePath: "rt::TsonicError" };
  const value = { kind: "identifier", name: "original" };
  for (const variant of ["Failure", "Changed"]) {
    for (const owner of ["root", "unrelated"]) {
      const context = {
        diagnostics: [], usedAliases: new Set(),
        input: { program: { projectTypes: policy, source: { ast: {
          getFileName: () => "/failure.ts", getSourceText: () => "", pos: () => 0, end: () => 0,
          kindName: () => "KindIdentifier",
        } } } },
        sourcePackageErrors: {
          componentIdByDefinition: new Map([[definition, owner]]),
          domainsByComponentId: new Map([["root", { definitions: [definition], externalErrors: [] }]]),
          dependencyErrorsByComponentId: new Map(),
        },
      };
      const result = planRustProgramErrorConstruction({ kind: "program-error", source, target, variant },
        value, undefined, context, boundary);
      if (variant === "Failure" && owner === "root") {
        assert.deepEqual(result, { kind: "call", path: "rt::TsonicError::Failure", args: [value] });
        assert.deepEqual(context.diagnostics, []);
      } else {
        assert.equal(result, undefined);
        assert.equal(context.diagnostics.length, 1);
      }
    }
  }
});
