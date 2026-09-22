import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { rustJsArrayTargetType } from "../../../dist/target-model/types/index.js";

test("native variadic sequences retain initialized values, widths, exhaustion and exception ordering", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "rest_sequences" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint8 } from "@tsonic/core/types.js";
export function main(): void {
  const bytes: uint8[] = [65, 66];
  const numbers: number[] = [67, 68];
  const empty: number[] = [];
  check(String.fromCharCode(...bytes, ...empty, ...numbers) === "ABCD");
  check(String.fromCharCode(...empty) === "");
  check(String.fromCharCode(...[]) === "");
  const tuple: [uint8, number] = [65, 66];
  check(String.fromCharCode(...tuple) === "AB");
  let tupleReads = 0;
  const readTuple = (): [uint8, number] => { tupleReads += 1; return tuple; };
  check(String.fromCharCode(...readTuple(), ...[], 67) === "ABC" && tupleReads === 1);
  check(String.fromCodePoint(...[128512]) === "😀");
  check(Math.max(2, ...[3, 8], ...empty, 4) === 8);
  check(Math.min(...[3, 8], 2) === 2 && Math.hypot(...[3, 4]) === 5);
  const initialized = new Array<number>(2);
  initialized[0] = 65;
  check(String.fromCharCode(...initialized) === "A\\0");
  check(Math.max(...initialized) === 65);
  const mutable: number[] = [66];
  let evaluations = 0;
  const next = (): number => { evaluations += 1; mutable[0] = 88; return 67; };
  check(String.fromCharCode(65, ...mutable, next(), ...mutable) === "ABCX");
  check(evaluations === 1 && mutable[0] === 88);
  let caught = 0;
  try { String.fromCodePoint(...[1.5], next()); } catch { caught += 1; }
  check(caught === 1 && evaluations === 2);
  const fail = (): number => { throw new Error("stop"); };
  try { String.fromCharCode(...bytes, fail(), next()); } catch { caught += 1; }
  check(caught === 2 && evaluations === 2);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactText(result, "src/index.rs");
  assert.match(emitted, /\.extend\(/u);
  assert.doesNotMatch(emitted, /spread_slot|unwrap_or\(f64::NAN\)/u);
  assert.equal(validateGeneratedProject(`provider-rest-sequences-${process.pid}`, result.artifacts, { run: true }).stdout.trim(), "");
});

test("sequence ABI rejects missing, conflicting and unproved input contracts", () => {
  const float = { kind: "source-primitive", name: "float64" };
  const byte = { kind: "source-primitive", name: "uint8" };
  const options = {
    operationKind: "method",
    form: { form: "call-value-slice", path: "acme::numbers", leadingArguments: [], elementCarrier: float },
    sourceArgumentCarriers: [float, rustJsArrayTargetType(byte)],
    spreadSourceArgumentIndexes: [1], resultCarrier: float, isAsync: false, isFallible: false,
  };
  const abi = finalizeRustProviderOperationAbi(options);
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  for (const indexes of [[-1], [2], [1, 1], [NaN], [0]]) {
    assert.equal(finalizeRustProviderOperationAbi({ ...options, spreadSourceArgumentIndexes: indexes }), undefined);
  }
  const accessorIndexes = [1];
  Object.defineProperty(accessorIndexes, "0", { get() { throw new Error("must not invoke metadata getter"); } });
  for (const indexes of [accessorIndexes, new Array(1), Object.assign([1], { extra: true })]) {
    assert.equal(finalizeRustProviderOperationAbi({ ...options, spreadSourceArgumentIndexes: indexes }), undefined);
  }
  assert.equal(finalizeRustProviderOperationAbi({ ...options, form: { ...options.form, sequenceHolePolicy: "number-nan" } }), undefined);
  assert.ok(finalizeRustProviderOperationAbi({ ...options,
    sourceArgumentCarriers: [float, { kind: "array", element: byte }] }));
  const narrow = { ...options, form: { ...options.form, elementCarrier: byte },
    sourceArgumentCarriers: [{ kind: "array", element: float }], spreadSourceArgumentIndexes: [0] };
  assert.equal(finalizeRustProviderOperationAbi(narrow), undefined);
  for (const mutate of [
    value => { value.sourceArguments[1].form = "value"; },
    value => { delete value.sourceArguments[1].form; },
    value => { value.targetArguments[0].elements[1].conversion.conversion.holePolicy = "reject"; },
    value => { value.targetArguments[0].elements[1].conversion.conversion.elementTarget = byte; },
    value => { value.targetArguments[0].elements[1].parameterCarrier = float; },
    value => { value.targetArguments[0].source.sourceIndexes.reverse(); },
    value => { value.targetArguments[0].elements[1].conversion.conversion.extra = true; },
    value => { value.target.sequenceHolePolicy = "number-nan"; },
    value => { value.sourceArguments[1].disposition = "compile-time"; },
    value => { value.targetArguments[0].elements[1].conversion.conversion.elementConversions = []; },
    value => { value.targetArguments[0].elements[1].conversion.conversion.elementConversions = [null]; },
    value => { value.targetArguments[0].elements[1].conversion.conversion.elementConversions[0].source = float; },
  ]) {
    const changed = structuredClone(abi);
    mutate(changed);
    assert.equal(validateRustFinalizedOperationAbi(changed), false);
  }
});

test("owned and receiver rest arrays retain the same closed sequence evidence", () => {
  const element = { kind: "source-primitive", name: "float64" };
  const receiver = rustJsArrayTargetType(element);
  for (const form of [
    { form: "call-value-array", path: "acme::values", leadingArguments: [], elementCarrier: element },
    { form: "receiver-value-array", name: "extend_values", receiverMode: "ref", leadingArguments: [], elementCarrier: element },
  ]) {
    const options = {
      operationKind: "method", form,
      ...(form.form === "receiver-value-array" ? { sourceReceiverCarrier: receiver } : {}),
      sourceArgumentCarriers: [receiver], spreadSourceArgumentIndexes: [0],
      resultCarrier: element, isAsync: false, isFallible: false,
    };
    const abi = finalizeRustProviderOperationAbi(options);
    assert.ok(abi);
    assert.equal(validateRustFinalizedOperationAbi(abi), true);
    assert.equal(abi.targetArguments[0].source.kind, "argument-array");
    assert.equal(abi.targetArguments[0].elements[0].conversion.conversion.kind, "rest-sequence");
    for (const mutate of [
      value => { value.sourceArguments[0].form = "value"; },
      value => { value.targetArguments[0].elements[0].parameterCarrier = element; },
      value => { value.targetArguments[0].elementCarrier = receiver; },
      value => { value.targetArguments[0].source.sourceIndexes = []; },
    ]) {
      const changed = structuredClone(abi);
      mutate(changed);
      assert.equal(validateRustFinalizedOperationAbi(changed), false);
    }
    assert.equal(finalizeRustProviderOperationAbi({ ...options,
      form: { form: "call", path: "acme::value" } }), undefined);
    assert.equal(finalizeRustProviderOperationAbi({ ...options,
      form: { ...form, leadingArguments: [{ carrier: element, mode: "value" }] } }), undefined);
  }
});
