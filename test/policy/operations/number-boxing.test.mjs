import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { numberBoxingProof, numberBoxingOutput } from "../../../../tsonic/test/fixtures/number-boxing.mjs";

const jsValue = { kind: "target-named", id: "rust.js.JsValue" };
const admitted = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64"];

test("closed number boxing accepts only exactly representable source domains", () => {
  for (const name of admitted) {
    const source = { kind: "source-primitive", name };
    const conversion = selectRustSourceValueConversion(source, jsValue);
    assert.ok(conversion, name);
    assert.deepEqual(rustValueConversionContract(conversion), {
      category: "exact", lowering: "call", path: "js_abi::JsValue::from",
      sourceMode: "value", source, target: jsValue, fallible: false,
    });
    const array = { kind: "target-named", id: "rust.js.JsArray", genericArguments: [{ kind: "type", type: source }] };
    const arrayConversion = selectRustSourceValueConversion(array, jsValue);
    assert.equal(arrayConversion?.kind, "js-value-from-array");
    assert.deepEqual(arrayConversion.elementConversion, conversion);
  }
  for (const name of ["int64", "uint64", "int128", "uint128", "native-int", "native-uint", "float16", "decimal", "char"]) {
    assert.equal(selectRustSourceValueConversion({ kind: "source-primitive", name }, jsValue), undefined, name);
  }
  assert.equal(rustValueConversionContract({ kind: "semantic-conversion", id: "js-value-from-u64" }), undefined);
});

test("sealed number boxing rejects source-domain and conversion mutations", () => {
  const source = { kind: "source-primitive", name: "uint32" };
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method", form: { form: "call", path: "sink",
      argConversions: [selectRustSourceValueConversion(source, jsValue)] },
    sourceArgumentCarriers: [source],
    resultCarrier: { kind: "tuple", elements: [] }, isAsync: false, isFallible: false,
  });
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  const mismatched = structuredClone(abi);
  mismatched.targetArguments[0].conversion.sourceCarrier = { kind: "source-primitive", name: "uint64" };
  assert.equal(validateRustFinalizedOperationAbi(mismatched), false);
  const malformed = structuredClone(abi);
  malformed.targetArguments[0].conversion.conversion.id = "js-value-from-u64";
  assert.equal(validateRustFinalizedOperationAbi(malformed), false);
});

test("number boxing executes the shared C# and Rust source proof", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "number_boxing" } },
    files: { "index.ts": `${numberBoxingProof}\nexport function main(): void { if (!run()) throw new Error("boxing effects"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const execution = validateGeneratedProject("number-boxing", result.artifacts, { run: true });
  assert.equal(execution.status, 0);
  assert.equal(execution.stdout, numberBoxingOutput);
});
