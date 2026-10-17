import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const fractional = [
  ["mixed0", "[signed, unsigned, 0.5]", [-7, 4294967295, 0.5]],
  ["mixed1", "[signed, 0.5, unsigned]", [-7, 0.5, 4294967295]],
  ["mixed2", "[0.5, signed, unsigned]", [0.5, -7, 4294967295]],
];
const integer = [
  ["integer0", "[signed, 1]", [-7, 1]],
  ["integer1", "[1, signed]", [1, -7]],
  ["integer2", "[signed, 1, 2]", [-7, 1, 2]],
  ["integer3", "[1, signed, 2]", [1, -7, 2]],
  ["integer4", "[1, 2, signed]", [1, 2, -7]],
  ["integer5", "[signed, otherSigned, 1]", [-7, 11, 1]],
  ["integer6", "[signed, 1, otherSigned]", [-7, 1, 11]],
  ["integer7", "[1, signed, otherSigned]", [1, -7, 11]],
];
const declarations = [
  ...fractional.map(([name, expression]) => `export function ${name}(signed: int32, unsigned: uint32) {
  const values = ${expression}; return values;
}`),
  ...integer.map(([name, expression]) => `export function ${name}(signed: int32, otherSigned: int32) {
  const values = ${expression}; return values;
}`),
];
const observed = [...fractional.map(([name, , values]) => [name, "-7, 4294967295", values]),
  ...integer.map(([name, , values]) => [name, "-7, 11", values])];
const verificationBindings = observed.map(([name, argumentsText]) => `const ${name}Values = ${name}(${argumentsText});`).join("\n");
const verification = observed.flatMap(([name, , values]) => [
  `${name}Values.length === ${values.length}`,
  ...values.map((value, index) => `${name}Values[${index}] === ${value}`),
]).join(" &&\n");
const source = `
import type { float32, int32, int64, uint32 } from "@tsonic/core/types.js";
${declarations.join("\n")}
export function verify(): boolean {
  ${verificationBindings}
  const wide: int64 = 9007199254740993n;
  const signed: int32 = -7;
  const unsigned: uint32 = 4294967295;
  const widePair = [wide, wide];
  const wideLiteral = [wide, 1];
  const genuine = [signed, wide];
  const integerUnion = [signed, unsigned];
  const explicit: number[] = [signed, unsigned];
  const numbers: number[] = [0.5, 3.5];
  const spread = [1, ...numbers, 2];
  const suffix = [...numbers, 1, 2];
  return ${verification} &&
    widePair[0] === wide && widePair[1] === wide && wideLiteral[0] === wide && wideLiteral[1] === 1 &&
    genuine[0] === signed && genuine[1] === wide && integerUnion[0] === signed && integerUnion[1] === unsigned &&
    explicit[0] === -7 && explicit[1] === 4294967295 &&
    spread.length === 4 && spread[0] === 1 && spread[1] === 0.5 && spread[2] === 3.5 && spread[3] === 2 &&
    suffix.length === 4 && suffix[0] === 0.5 && suffix[1] === 3.5 && suffix[2] === 1 && suffix[3] === 2;
}
export function negativeZero(signed: int32): number { const values = [signed, -0]; return values[1]; }
export function nativeFloat32(narrow: float32): float32 { const values = [narrow, 0.1]; return values[1]; }
export function wideExact(wide: int64): int64 { const values = [wide, 1]; return values[0]; }
let trace: int32 = 0;
function signedValue(): int32 { trace = trace * 10 + 1; return -7; }
function floatingValues(): number[] { trace = trace * 10 + 2; return [0.5]; }
function unsignedValue(): uint32 { trace = trace * 10 + 3; return 4294967295; }
export function effectOrder(): int32 {
  trace = 0;
  const values = [signedValue(), ...floatingValues(), unsignedValue()];
  if (values.length !== 3 || values[0] !== -7 || values[1] !== 0.5 || values[2] !== 4294967295) return -1;
  return trace;
}
`;

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`C102 ${lane}: complete numeric aggregates preserve native values, ordering and exact allocation costs`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib", crateName: "numeric_arrays" } },
      files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 8).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
    const generated = artifactText(result, "src/index.rs");
    const arrayType = lane === "native" ? "Vec" : "js_abi::JsArray";
    for (const [name] of fractional) {
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${arrayType}<f64>`, "u").test(generated), true,
        `${name}: inferred destination is the native floating element`);
    }
    for (const [name] of integer) {
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${arrayType}<i32>`, "u").test(generated), true,
        `${name}: exact integer peer, no floating detour`);
    }
    assert.equal(/i64_to_f64|u64_to_f64|\.to_vec\(|\.collect::<|Box::new/u.test(generated), false,
      "no wide rounding, intermediate collection, clone buffer or box");
    const resultType = `${arrayType}<f64>`;
    const allocationCount = lane === "native" ? 1 : 2;
    const handwritten = fractional.map(([name, , values], index) => {
      const entries = values.map(value => value === -7 ? "f64::from(signed)" : value === 4294967295 ? "f64::from(unsigned)" : "0.5_f64").join(", ");
      const construction = lane === "native" ? `vec![${entries}]` : `js_abi::JsArray::from_dense(vec![${entries}])`;
      return `fn handwritten${index}(signed: i32, unsigned: u32) -> ${resultType} { ${construction} }`;
    }).join("\n");
    const proof = `
#[cfg(test)]
mod c102_native_proof {
use super::*;
${nativeOwnershipCostSupport}
${handwritten}
#[test]
fn exact_values_widths_signed_zero_and_source_order() {
    assert!(verify());
    assert_eq!(wideExact(9_007_199_254_740_993_i64), 9_007_199_254_740_993_i64);
    assert_eq!(negativeZero(-7).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(nativeFloat32(1.5_f32).to_bits(), 0.1_f32.to_bits());
    assert_eq!(effectOrder(), 123);
}
#[test]
fn exact_per_operation_native_cost() {
    type Constructor = fn(i32, u32) -> ${resultType};
    let pairs: [(Constructor, Constructor); 3] = [(mixed0, handwritten0), (mixed1, handwritten1), (mixed2, handwritten2)];
    for (index, (generated, native)) in pairs.into_iter().enumerate() {
        for iteration in 0..1000 {
            let (value, cost) = measure(|| generated(std::hint::black_box(-7), std::hint::black_box(u32::MAX)));
            let (expected, expected_cost) = measure(|| native(std::hint::black_box(-7), std::hint::black_box(u32::MAX)));
            assert_eq!(cost, expected_cost);
            assert_eq!(cost.allocations, ${allocationCount});
            assert_eq!(cost.reallocations, 0);
            if iteration == 0 { eprintln!("C102 ${lane} mixed{index}: {cost:?}"); }
            drop(value);
            drop(expected);
        }
    }
}
}
`;
    const artifacts = result.artifacts.map(artifact => artifact.path === "src/index.rs"
      ? { ...artifact, text: artifact.text + proof } : artifact);
    const root = writeGeneratedProject(`inferred-numeric-arrays-${lane}`, artifacts);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt"]);
    runCargo(root, ["fmt", "--all", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const checked = runCargo(root, ["test", "--locked", "--offline", "--", "--nocapture"]);
    process.stdout.write(checked.stdout + checked.stderr);
  });
}
