import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sourceErrorConstructorCostProof, sourceErrorConstructorProof, sourceExplicitErrorInitializationCostProof,
  sourceExplicitErrorInitializationProof, sourceJsErrorConstructorProof, sourceOwnedErrorConstructorProof } from "../../../../tsonic/test/fixtures/source-error-constructors.mjs";
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
  test(`explicit native error fields preserve owned inputs, reused inputs and absence effects (${profile})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": sourceExplicitErrorInitializationProof + `
        export function main(): void { if (!run()) throw new Error("explicit error initialization"); }` } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`explicit-error-initialization-${profile}`, result.artifacts, { run: true });
  });
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

for (const surfaces of [[], ["js"]]) {
  test(`explicit native error field initialization matches owned storage cost (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { crateName: "explicit_error_cost" } },
      files: { "index.ts": sourceExplicitErrorInitializationCostProof } });
    assertNoTargetDiagnostics(result.diagnostics);
    const root = writeGeneratedProject(`explicit-error-cost-${surfaces[0] ?? "native"}`, result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use explicit_error_cost::index;

#[test]
fn terminal_owned_inputs_have_no_copy_and_retained_inputs_have_one_native_copy() {
    for _ in 0..1000 {
        let input = String::from("café😀 owned message");
        let required = input.clone();
        let optional = input.clone();
        let retained = input.clone();
        let implicit = measure(|| index::ImplicitOwnedFailure::new(Some(input)));
        let actual = measure(|| index::RequiredOwnedFailure::new(required));
        assert_eq!(actual.1, implicit.1);
        let actual_optional = measure(|| index::OptionalOwnedFailure::new(Some(optional)));
        assert_eq!(actual_optional.1, implicit.1);
        let actual_retained = measure(|| index::RetainedOwnedFailure::new(retained));
        assert_eq!(actual_retained.1.allocations, implicit.1.allocations + 1);
        assert_eq!(actual_retained.1.allocated_bytes, implicit.1.allocated_bytes + "café😀 owned message".len()
            + std::mem::size_of::<index::RetainedOwnedFailureState>() - std::mem::size_of::<index::ImplicitOwnedFailureState>());
        assert_eq!(actual_retained.1.reallocations, implicit.1.reallocations);
    }
    assert_eq!(measure(|| index::OptionalOwnedFailure::new(None)).1,
        measure(|| index::ImplicitOwnedFailure::new(None)).1);
}
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt", "--all"]);
    runCargo(root, ["fmt", "--all", "--check"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(root, ["test", "--release", "--locked", "--offline"]);
  });
}

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
  assertNoTargetDiagnostics(input.diagnostics);
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
