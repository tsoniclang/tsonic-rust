import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sourceErrorConstructorCostProof, sourceErrorConstructorProof, sourceJsErrorConstructorProof, sourceOwnedErrorConstructorProof } from "../../../../tsonic/test/fixtures/source-error-constructors.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { planRustExternalProjectInitialization } from "../../../dist/backend/planner/objects/polymorphism/external-construction.js";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustBorrowedStrTargetType, rustSourceOptionalTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustOptionalStringToBorrowedStrValueConversion } from "../../../dist/target-model/conversions/model.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { lowerRustValueConversion } from "../../../dist/backend/planner/expressions/value-conversions.js";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  for (const [name, source] of [["inherited-native", sourceErrorConstructorProof], ["same-spelled-project", sourceOwnedErrorConstructorProof]]) {
    test(`${name} error constructors retain exact arguments and project types (${profile})`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
        files: { "constructors.ts": source,
          "index.ts": `import { run } from "./constructors.js";
            export function main(): void { if (!run()) throw new Error("source error constructors"); }` },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n"));
      validateGeneratedProject(`source-error-constructors-${name}-${profile}`, result.artifacts, { run: true });
    });
  }
}

test("JS error constructor families preserve native optional message parameters", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "constructors.ts": sourceJsErrorConstructorProof,
      "index.ts": `import { run } from "./constructors.js";
        export function main(): void { if (!run()) throw new Error("JS error constructors"); }` },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  validateGeneratedProject("source-js-error-constructors", result.artifacts, { run: true });
});

test("optional native string conversion borrows the original storage and an empty literal", () => {
  const contract = rustValueConversionContract(rustOptionalStringToBorrowedStrValueConversion);
  assert.deepEqual(contract, { category: "ownership", lowering: "borrowed-str-from-optional-string", sourceMode: "ref",
    source: rustSourceOptionalTargetType(rustStringTargetType()),
    target: rustBorrowedStrTargetType(), fallible: false });
  const source = { kind: "reference", expr: { kind: "path", path: "message" } };
  assert.deepEqual(lowerRustValueConversion(contract, source, {}, undefined), {
    kind: "method-call", receiver: { kind: "method-call", receiver: source.expr, method: "as_deref", args: [] },
    method: "unwrap_or", args: [{ kind: "str-literal", value: "" }],
  });
});

test("native optional error messages retain handwritten construction costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { crateName: "error_constructor_cost" } },
    files: { "index.ts": sourceErrorConstructorCostProof } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  const root = writeGeneratedProject("source-error-constructor-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use error_constructor_cost::index;
use tsonic_rust_runtime::JsError;

fn handwritten(message: Option<String>) -> JsError {
    JsError::error(message.as_deref().unwrap_or(""))
}

#[test]
fn optional_and_required_inputs_match_native_costs() {
    let text = String::from("café😀 message");
    for _ in 0..10_000 {
        for message in [None, Some(String::new()), Some(text.clone())] {
            let control = message.clone();
            let actual = measure(|| index::makeOptional(message));
            let native = measure(|| handwritten(control));
            assert_eq!(actual.0.message(), native.0.message());
            assert_eq!(actual.0.stack(), None);
            assert_eq!(actual.1, native.1);
        }
        let actual = measure(|| index::makeRequired(text.as_str()));
        let native = measure(|| JsError::error(text.as_str()));
        assert_eq!(actual.0.message(), text);
        assert_eq!(actual.0.stack(), None);
        assert_eq!(actual.1, native.1);
    }
    assert_eq!(text, "café😀 message");
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
});

test("inherited native initialization consumes one selected owned message without a temporary base error", () => {
  const declaration = {};
  const parameter = {};
  const signature = { implicit: true, declaration, parameters: [{ parameterDeclaration: parameter,
    parameterName: "message", acceptsOmission: true, rest: false }] };
  const carrier = rustSourceOptionalTargetType(rustStringTargetType());
  const abi = { form: "optional", mode: "value", parameterCarrier: carrier, valueCarrier: carrier };
  const base = { constructorDeclarations: [declaration], fields: [
    { initializer: { kind: "string", value: "Error" } }, { initializer: { kind: "message", parameterIndex: 0 } },
    { initializer: { kind: "none" } },
  ] };
  const context = selected => ({ diagnostics: [], input: { program: {
    facts: { getFact: (node, key) => node === parameter && key === rustSourceParameterAbiFactKey ? selected : undefined },
    source: { ast: { getSourceFile: () => undefined, getFileName: () => "", getSourceText: () => "", pos: () => 0, end: () => 0,
      kindName: () => "KindClassDeclaration" } },
  } } });
  const input = context(abi);
  const planned = planRustExternalProjectInitialization(base, signature, declaration, undefined, input);
  assert.deepEqual(input.diagnostics, []);
  assert.deepEqual(planned, [{ kind: "string-literal", value: "Error" },
    { kind: "method-call", receiver: { kind: "path", path: "message" }, method: "unwrap_or_default", args: [] },
    { kind: "none" }]);
  for (const [changedBase, changedSignature, selected] of [
    [base, signature, undefined], [base, signature, { ...abi, mode: "ref" }],
    [base, signature, { ...abi, parameterCarrier: rustStringTargetType() }],
    [base, signature, { ...abi, valueCarrier: rustStringTargetType() }],
    [{ ...base, constructorDeclarations: [{}] }, signature, abi],
    [base, { ...signature, implicit: false }, abi],
    [base, { ...signature, declaration: {} }, abi],
    [base, { ...signature, parameters: [] }, abi],
    [base, { ...signature, parameters: [{ ...signature.parameters[0], rest: true }] }, abi],
    [base, { ...signature, parameters: [{ ...signature.parameters[0], acceptsOmission: false }] }, abi],
    [{ ...base, fields: [{ initializer: { kind: "message", parameterIndex: 1 } }] }, signature, abi],
  ]) {
    const input = context(selected);
    assert.equal(planRustExternalProjectInitialization(changedBase, changedSignature, declaration, undefined, input), undefined);
    assert.equal(input.diagnostics.length, 1);
    assert.match(input.diagnostics[0].message, /exact selected native constructor/u);
  }
});
