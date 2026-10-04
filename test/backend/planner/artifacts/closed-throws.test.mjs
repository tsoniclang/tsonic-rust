import assert from "node:assert/strict";
import test from "node:test";
import { planRustClosedThrowAdmission } from "../../../../dist/backend/planner/program/closed-throws.js";
import { planRustErrorTransport } from "../../../../dist/backend/planner/program/error-transport.js";
import { planRustErrorObservations } from "../../../../dist/backend/planner/program/error-observations.js";
import { planRustProgramErrorConstruction } from "../../../../dist/backend/planner/expressions/program-errors.js";
import { selectRustProgramErrorConversion } from "../../../../dist/target-model/conversions/program-error.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

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
  for (const source of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const conversion = selectRustProgramErrorConversion(source);
    const value = { kind: "path", path: "original" };
    for (const [componentId, errorDomain, accepted] of [["root", "project", true],
      ["root", "runtime", false], ["other", "project", false]]) {
      const context = { diagnostics: [], sourcePackageComponentId: "root", input: { program: {
        typeDefinitions: emptyRustTypeDefinitions,
        source: { ast: { getFileName: () => "", getSourceText: () => "", pos: () => -1,
          end: () => -1, kindName: () => "KindIdentifier" } },
      } } };
      const result = planRustProgramErrorConstruction(conversion, value, {}, context,
        { componentId, errorDomain, errorTypePath: "rt::TsonicError" });
      assert.equal(result !== undefined, accepted, `${componentId}:${errorDomain}`);
      assert.equal(context.diagnostics.length, accepted ? 0 : 1);
      if (accepted) {
        assert.equal(result.path, "rt::TsonicError::from");
        assert.equal(result.args[0] === value, true, "the identical closed payload is consumed");
      }
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
