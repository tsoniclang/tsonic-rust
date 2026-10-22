import assert from "node:assert/strict";
import test from "node:test";
import { planRustClosedThrowAdmission } from "../../../../dist/backend/planner/program/closed-throws.js";
import { planRustErrorTransport } from "../../../../dist/backend/planner/program/error-transport.js";
import { planRustErrorObservations } from "../../../../dist/backend/planner/program/error-observations.js";
import { planRustProgramErrorConstruction } from "../../../../dist/backend/planner/expressions/program-errors.js";
import { selectRustProgramErrorConversion } from "../../../../dist/policy/conversions/program-error.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../../dist/target-model/types/index.js";
import { rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

const variants = [
  { name: "ClosedNative", type: { kind: "named", path: "tsonic_rust_runtime::TsValue" }, source: "thrown" },
  { name: "ClosedJs", type: { kind: "named", path: "tsonic_rust_js::value::JsValue" }, source: "thrown" },
];

test("one consuming closed throw admission keeps Error capabilities and exact rejected payloads", () => {
  const implementations = planRustClosedThrowAdmission(variants);
  assert.equal(implementations.length, 2);
  for (const [index, implementation] of implementations.entries()) {
    assert.deepEqual(implementation.trait.genericArguments[0].type, variants[index].type);
    const selection = implementation.members[0].body.statements[0].expr;
    assert.equal(selection.kind, "match");
    assert.equal(selection.expression.method, "into_error");
    assert.equal(selection.arms[0].pattern.path, "Ok");
    assert.equal(selection.arms[0].expression.path, "Self::Retained");
    assert.equal(selection.arms[1].pattern.path, "Err");
    assert.equal(selection.arms[1].expression.path, `Self::${variants[index].name}`);
    assert.deepEqual(selection.arms[1].expression.args, [{ kind: "path", path: "value" }]);
    assert.doesNotMatch(JSON.stringify(implementation), /clone|Box|to_string|from_closed|Any|unsafe/u);
  }
});

test("closed throw construction requires its exact owning native Error domain", () => {
  const conversions = [rustTsValueTargetType(), rustJsValueTargetType()].map(source => selectRustProgramErrorConversion(source));
  // Type emission records for the conversion targets, selected by their analysis owner.
  const program = rustProgramWithTypeEmissions(conversions.map(conversion => conversion.target), { surfaces: ["js"] });
  for (const conversion of conversions) {
    const value = { kind: "path", path: "original" };
    for (const [componentId, errorDomain, accepted] of [["root", "project", true],
      ["root", "runtime", false], ["other", "project", false]]) {
      const context = { diagnostics: [], usedAliases: new Set(), sourcePackageComponentId: "root",
        input: { program: { source: program.source, records: program.records } } };
      const plan = () => planRustProgramErrorConstruction(conversion, value, {}, context,
        { componentId, errorDomain, errorTypePath: "rt::TsonicError" });
      if (!accepted) {
        assert.throws(plan, error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
          /own source-package payload transport/u.test(error.diagnostic.message), `${componentId}:${errorDomain}`);
        continue;
      }
      const result = plan();
      assert.equal(context.diagnostics.length, 0);
      assert.equal(result.path, "rt::TsonicError::from");
      assert.equal(result.args[0] === value, true, "the identical closed payload is consumed");
    }
  }
});

test("Error-only views exclude non-Error closed payloads without another physical enum", () => {
  const plan = planRustErrorTransport([...variants, { name: "Retained", source: "external",
    type: { kind: "named", path: "tsonic_rust_runtime::RetainedError" },
    sourceErrorType: { kind: "named", path: "tsonic_rust_runtime::RetainedError" },
    writableSourceErrorType: { kind: "named", path: "tsonic_rust_runtime::WritableRetainedError" },
  }]);
  assert.ok(plan);
  const source = plan.aliases.find(item => item.name === "SourceError");
  const payloads = source.fields[0].type.genericArguments.map(argument => argument.type);
  assert.equal(payloads.filter(type => type.path === "core::convert::Infallible").length, 2);
  const sourceError = planRustErrorObservations(plan).members.find(member => member.name === "source_error");
  for (const item of variants) {
    const arm = sourceError.body.statements[0].expr.arms.find(arm => arm.pattern.path === `ErrorTransport::${item.name}`);
    assert.equal(arm.expression.kind, "none");
  }
  assert.equal(plan.aliases.some(item => item.kind === "enum"), false);
});
