import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { rustJsArrayTargetType } from "../../../dist/target-model/types/index.js";

test("native variadic sequences retain holes, widths, exhaustion and exception ordering", { timeout: 300_000 }, () => {
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
  const holes = new Array<number>(2);
  holes[0] = 65;
  check(String.fromCharCode(...holes) === "A\\0");
  check(Number.isNaN(Math.max(...holes)));
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
  assert.match(emitted, /f64::NAN/u);
  assert.equal(validateGeneratedProject(`provider-rest-sequences-${process.pid}`, result.artifacts, { run: true }).stdout.trim(), "");
});

test("sequence ABI rejects missing, conflicting and unproved input contracts", () => {
  const float = { kind: "source-primitive", name: "float64" };
  const byte = { kind: "source-primitive", name: "uint8" };
  const options = {
    operationKind: "method",
    form: { form: "call-value-slice", path: "acme::numbers", leadingArguments: [], elementCarrier: float, sequenceHolePolicy: "number-nan" },
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
  const { sequenceHolePolicy, ...withoutHolePolicy } = options.form;
  assert.equal(sequenceHolePolicy, "number-nan");
  assert.equal(finalizeRustProviderOperationAbi({ ...options, form: withoutHolePolicy }), undefined);
  assert.ok(finalizeRustProviderOperationAbi({ ...options, form: withoutHolePolicy,
    sourceArgumentCarriers: [float, { kind: "array", element: byte }] }));
  const narrow = { ...options, form: { ...withoutHolePolicy, elementCarrier: byte },
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
    value => { delete value.target.sequenceHolePolicy; },
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
