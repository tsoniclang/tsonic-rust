import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const float64 = { kind: "source-primitive", name: "float64" };
const kinds = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint", "float32", "float64"];
const options = (name) => ({ operationKind: "method", form: { form: "numeric-cast", target: "float64" }, sourceArgumentCarriers: [{ kind: "source-primitive", name }], resultCarrier: float64, isAsync: false, isFallible: false });

test("Number selects allocation-free native conversion for every scalar numeric carrier", () => {
  for (const name of kinds) {
    const selected = selectJsSurfaceOperation({ ownerName: "NumberConstructor", memberName: "call", operationKind: "call", argumentCarriers: [{ kind: "source-primitive", name }] });
    assert.equal(selected?.fact.operationId, "tsonic.rust.js.NumberConstructor.call.call.numeric-scalar", name);
    assert.deepEqual(selected.fact.target, { form: "numeric-cast", target: "float64" });
    const abi = finalizeRustProviderOperationAbi(options(name));
    assert.ok(abi, name);
    assert.equal(validateRustFinalizedOperationAbi(abi), true);
    assert.equal(abi.targetArguments[0].conversion.kind, name === "float64" ? "identity" : "semantic");
    if (name !== "float64") assert.deepEqual(abi.targetArguments[0].conversion.conversion, { kind: "numeric-promotion", source: name, target: "float64" });
  }
});

test("native numeric operation rejects invalid arity, carriers, effects and mutated results", () => {
  const base = options("uint64");
  for (const change of [
    { sourceArgumentCarriers: [] },
    { sourceArgumentCarriers: [float64, float64] },
    { sourceArgumentCarriers: [{ kind: "source-primitive", name: "bool" }] },
    { form: { form: "numeric-cast", target: "bool" } },
    { form: { form: "numeric-cast", target: "float64", unchecked: true } },
    { resultCarrier: { kind: "source-primitive", name: "int32" } },
    { operationKind: "constructor" }, { isAsync: true },
    { isFallible: true, errorBoundary: "source-program" }, { isUnsafe: true },
    { targetGenericArguments: [{ kind: "type", type: float64 }] },
  ]) assert.equal(finalizeRustProviderOperationAbi({ ...base, ...change }), undefined, JSON.stringify(change));
  const abi = finalizeRustProviderOperationAbi(base);
  assert.equal(validateRustFinalizedOperationAbi({ ...abi, target: { ...abi.target, target: "float32" } }), false);
  assert.equal(validateRustFinalizedOperationAbi({ ...abi, targetArguments: [] }), false);
});

test("native Number conversions execute with rounding, identity and single evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_number_conversion" } },
    files: { "shadow.ts": `
function Number(value: number): number { return value + 3; }
export function local(): number { return Number(4); }
`, "index.ts": `
import { check } from "@acme/testing";
import { local } from "./shadow.js";
import type { int8, uint8, int16, uint16, int32, uint32, int64, uint64, int128, uint128, nativeInt, nativeUint, float32 } from "@tsonic/core/types.js";
${kinds.map((name) => `function convert${kinds.indexOf(name)}(value: ${name === "float64" ? "number" : name === "native-int" ? "nativeInt" : name === "native-uint" ? "nativeUint" : name}): number { return Number(value); }`).join("\n")}
let calls: int32 = 0;
function next(): uint64 { calls += 1; return 9007199254740993n; }
export function main(): void {
  check(convert0(-128) === -128 && convert1(255) === 255);
  check(convert2(-32768) === -32768 && convert3(65535) === 65535);
  check(convert4(-2147483648) === -2147483648 && convert5(4294967295) === 4294967295);
  const exact: uint64 = 9007199254740993n;
  check(convert6(-9007199254740993n) === -9007199254740992 && convert7(exact) === 9007199254740992);
  check(exact === 9007199254740993n && convert7(18446744073709551615n) === 18446744073709551616);
  check(convert8(-170141183460469231731687303715884105728n) === -1.7014118346046923e38);
  check(convert9(340282366920938463463374607431768211455n) === 3.402823669209385e38);
  check(convert10(-42) === -42 && convert11(42) === 42 && convert12(1.5) === 1.5);
  check(1 / convert13(-0) === Number.NEGATIVE_INFINITY && convert13(Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY);
  check(Number.isNaN(convert13(Number.NaN)));
  check(Number(next()) === 9007199254740992 && calls === 1);
  const plain = 1.5;
  Number(plain);
  Number(exact);
  Number(next());
  check(calls === 2);
  check(local() === 7);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /value as f64/u);
  assert.doesNotMatch(source, /bigint_from|SourceNumeric|to_number|u64_to_f64/u);
  const run = validateGeneratedProject("native-number-conversion", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
