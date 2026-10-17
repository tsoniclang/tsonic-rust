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
const verification = observed.flatMap(([name, , values]) =>
  values.map((value, index) => `${name}Values[${index}] === ${value}`)).join(" &&\n");
const physicalForms = [
  ["bare", "[signed, unsigned]", ["int32", "uint32"]],
  ["reverse", "[unsigned, signed]", ["uint32", "int32"]],
  ["literalLast", "[signed, unsigned, 1]", ["int32", "uint32", "float64"]],
  ["literalMiddle", "[signed, 1, unsigned]", ["int32", "float64", "uint32"]],
  ["literalFirst", "[1, signed, unsigned]", ["float64", "int32", "uint32"]],
];

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`C130 ${lane}: physical integer unions preserve native payload values, cross-arm equality and exact cost`, { timeout: 300_000 }, () => {
    const files = { "index.ts": 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
      physicalForms.map(([name, expression, names]) => `
export function ${name}(signed: int32, unsigned: uint32) { const values = ${expression}; return values; }
export function ${name}Equal(signed: int32, unsigned: uint32): boolean {
  const values = ${expression};
  return ${names.slice(1).map((_, index) =>
    `values[0] === values[${index + 1}] && !(values[0] !== values[${index + 1}])`).join(" && ")};
}`).join("\n") };
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_arrays" } }, files });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 8).map(row => `${row.code}: ${row.message}`).join("\n"));
    const generated = artifactText(result, "src/index.rs");
    const allGenerated = result.artifacts.map(artifact => artifact.text).join("\n");
    const array = lane === "native" ? "Vec" : "js_abi::JsArray";
    const nativeType = { int32: "i32", uint32: "u32", float64: "f64" };
    const cases = physicalForms.map(([name, , names]) => {
      const carrier = new RegExp(`fn ${name}\\([^)]*\\) -> ${array}<([^\\n]+)>\\s*\\{`, "u").exec(generated)?.[1];
      assert.equal(carrier !== undefined, true, `${name}: native physical union array, never all-f64`);
      const application = /^(.+)<([^<>]+)>$/u.exec(carrier);
      assert.equal(application !== null, true, `${name}: the existing generated union has explicit native payload arguments`);
      const enumPath = application[1];
      const arguments_ = application[2].split(",").map(value => value.trim());
      const typeName = enumPath.split("::").at(-1);
      const declaration = new RegExp(`enum ${typeName}<([^>]+)>\\s*\\{([^}]+)\\}`, "u").exec(allGenerated);
      assert.equal(declaration !== null, true, `${name}: a real native enum owns the physical payloads`);
      const parameters = declaration[1].split(",").map(value => value.trim());
      assert.equal(parameters.length, arguments_.length, `${name}: every generic payload has one actual native argument`);
      const variants = new Map([...declaration[2].matchAll(/(Variant\d+)\(([^)]+)\)/gu)].map(match => {
        const index = parameters.indexOf(match[2].trim());
        assert.equal(index >= 0, true, `${name}: each variant stores its declared native payload parameter`);
        return [arguments_[index], match[1]];
      }));
      assert.equal(variants.size, names.length, `${name}: exact two or three physical arms`);
      for (const primitive of names) assert.equal(variants.has(nativeType[primitive]), true, `${name}: ${primitive} payload`);
      const entries = names.map(primitive => `${enumPath}::${variants.get(nativeType[primitive])}(${primitive === "int32"
        ? "signed" : primitive === "uint32" ? "unsigned" : "1.0_f64"})`).join(", ");
      const resultType = `${array}<${carrier}>`;
      const constructor = lane === "native" ? `vec![${entries}]` : `js_abi::JsArray::from_dense(vec![${entries}])`;
      const value = lane === "native" ? "&value[index]" : '&value.get(index).expect("a constructed dense element exists")';
      const arms = [...variants].map(([primitive, variant]) => `${enumPath}::${variant}(payload) => ${primitive === "f64"
        ? "*payload" : "f64::from(*payload)"}`).join(", ");
      const expected = names.map(primitive => primitive === "int32" ? "-1.0_f64" : primitive === "uint32" ? "4_294_967_295.0_f64" : "1.0_f64").join(", ");
      return `
fn handwritten_${name.toLowerCase()}(signed: i32, unsigned: u32) -> ${resultType} { ${constructor} }
fn check_${name.toLowerCase()}() {
    let value = ${name}(-1, u32::MAX);
    assert_eq!(value.len(), ${names.length});
    for (index, expected) in [${expected}].into_iter().enumerate() {
        let actual = match ${value} { ${arms} };
        assert_eq!(actual.to_bits(), expected.to_bits());
    }
    assert!(${name}Equal(1, 1)${lane === "native" ? '.expect("checked source reads succeed")' : ""});
    for iteration in 0..1000 {
        let (actual, cost) = measure(|| ${name}(std::hint::black_box(-1), std::hint::black_box(u32::MAX)));
        let (expected, expected_cost) = measure(|| handwritten_${name.toLowerCase()}(std::hint::black_box(-1), std::hint::black_box(u32::MAX)));
        assert_eq!(cost, expected_cost);
        assert_eq!(cost.allocations, ${lane === "native" ? 1 : 2});
        assert_eq!(cost.reallocations, 0);
        if iteration == 0 { eprintln!("C130 ${lane} ${name}: {cost:?}"); }
        drop(actual); drop(expected);
    }
}`;
    }).join("\n");
    const proof = `
#[cfg(test)]
mod c130_physical_native_proof {
use super::*;
${nativeOwnershipCostSupport}
${cases}
#[test]
fn physical_values_cross_arm_number_equality_and_native_cost() {
    ${artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : ""}
    ${physicalForms.map(([name]) => `check_${name.toLowerCase()}();`).join("\n    ")}
}
}
`;
    const root = writeGeneratedProject(`physical-numeric-arrays-${lane}`, result.artifacts.map(artifact =>
      artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + proof } : artifact));
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt"]);
    runCargo(root, ["fmt", "--all", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const checked = runCargo(root, ["test", "--locked", "--offline", "--", "--nocapture"]);
    process.stdout.write(checked.stdout + checked.stderr);
  });
}

const operationControls = [
  ["number read", "const value: number = values[0]; return value === 1;", ["values[0]"]],
  ["order", "return !(values[0] < values[1]);", ["values[0] < values[1]"]],
  ["addition", "return values[0] + values[1] === 2;", ["values[0] + values[1]"]],
  ["Object.is", "return Object.is(values[0], values[1]);", ["Object.is(values[0], values[1])"]],
  ["Math.max", "return Math.max(values[0], values[1]) === 1;", ["Math.max(values[0], values[1])"]],
  ["includes", "const first = [values[0]]; return first.includes(values[1]);", ["first.includes(values[1])"]],
  ["indexOf", "return values.indexOf(values[1]) === 0;", ["values.indexOf(values[1])"]],
  ["Set", "const keys = new Set(values); return keys.has(values[1]) && keys.size === 1;", ["new Set(values)", "keys.has(values[1])"]],
  ["Map", "const keys = new Map<number, boolean>(); keys.set(values[0], true); return keys.has(values[1]);",
    ["keys.set(values[0], true)", "keys.has(values[1])"]],
  ["String", 'return String(values[0]) === "1" && String(values[1]) === "1";', ["String(values[0])", "String(values[1])"]],
  ["template", 'return `${values[0]}:${values[1]}` === "1:1";', ["values[0]", "values[1]"]],
  ["JSON", 'return JSON.stringify(values) === EXPECTED_JSON;', ["JSON.stringify(values)"]],
  ["sort", 'values.sort(); return JSON.stringify(values) === EXPECTED_SORT;', ["values.sort()", "JSON.stringify(values)"]],
];

for (const [formName, form, names] of physicalForms.filter(([name]) => name !== "reverse")) {
  for (const [operation, body, anchors] of operationControls) {
    test(`C130 js: ${formName} ${operation} uses native number semantics or a precise pre-seal refusal`, { timeout: 300_000 }, () => {
      const expectedJson = names.length === 2 ? "[1,1]" : "[1,1,1]";
      const expectedSort = names.length === 2 ? "[10,2]" : "[1,10,2]";
      const source = 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
        `export function check(signed: int32, unsigned: uint32): boolean { const values = ${form}; ` +
        body.replace("EXPECTED_JSON", JSON.stringify(expectedJson)).replace("EXPECTED_SORT", JSON.stringify(expectedSort)) + " }";
      const { result, source: checkedSource, program } = compileRust({ surfaces: ["js"],
        target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_operation" } }, files: { "index.ts": source } });
      const issues = result.diagnostics.filter(issue => issue.category === "error");
      if (issues.length !== 0) {
        assert.equal(program === undefined, true, "an unsupported operation must be rejected before sealing and planning");
        assert.equal(result.artifacts.length, 0, "an unsupported physical-union operation emits no target source");
        for (const issue of issues) {
          assert.equal(["RUST_SELECTED_OPERATION_UNSUPPORTED", "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED",
            "RUST_TEMPLATE_SUBSTITUTION_UNSUPPORTED", "RUST_INITIALIZER_CARRIER_MISMATCH", "RUST_RETURN_CARRIER_MISMATCH",
            "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED", "RUST_CALL_ARGUMENT_CARRIER_MISMATCH"].includes(issue.code), true,
          `${operation}: an existing deciding owner, not a missing fact or native compiler failure (${issue.code}: ${issue.message})`);
          assert.equal(issue.sourceNode !== undefined && !/missing|not finalized|internal invariant/iu.test(issue.message), true,
            `${operation}: a precise source refusal, not an internal planner error`);
          const range = checkedSource.ast.authoredRange(issue.sourceNode);
          const text = checkedSource.ast.getSourceText(checkedSource.ast.getSourceFile(issue.sourceNode));
          assert.equal(range.kind === "authored" && anchors.some(anchor => text.slice(range.start, range.end).includes(anchor)), true,
            `${operation}: the diagnostic identifies the actual unsupported operation`);
        }
        process.stdout.write(`C130 ${formName} ${operation}: PRESEAL ${issues.map(issue => issue.code).join(",")}\n`);
        return;
      }
      const signature = /pub fn check\([^)]*\) -> (bool|Result<bool,[^\n]+>)\s*\{/u.exec(artifactText(result, "src/index.rs"));
      assert.equal(signature !== null, true, "the native observer consumes the actual sealed bool or fallible-bool ABI");
      const checkedResult = signature[1] === "bool" ? "" : '.expect("the admitted native number operation succeeds")';
      const proof = `
#[cfg(test)]
mod c130_native_operation_proof {
use super::*;
#[test]
fn exact_cross_arm_number_semantics() {
    ${artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : ""}
    assert!(check(${operation === "sort" ? "10, 2" : "1, 1"})${checkedResult});
}
}
`;
      const root = writeGeneratedProject(`physical-${formName}-${operation.replace(/[^a-z]/giu, "-")}`, result.artifacts.map(artifact =>
        artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + proof } : artifact));
      runCargo(root, ["generate-lockfile", "--offline"]);
      runCargo(root, ["fmt"]);
      runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      const checked = runCargo(root, ["test", "--locked", "--offline"]);
      process.stdout.write(`C130 ${formName} ${operation}: NATIVE\n` + checked.stdout + checked.stderr);
    });
  }
}
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
  const explicit: number[] = [signed, unsigned];
  const numbers: number[] = [0.5, 3.5];
  const spread = [1, ...numbers, 2];
  const suffix = [...numbers, 1, 2];
  return ${verification} &&
    widePair[0] === wide && widePair[1] === wide && wideLiteral[0] === wide && wideLiteral[1] === 1 &&
    genuine[0] === signed && genuine[1] === wide &&
    explicit[0] === -7 && explicit[1] === 4294967295 &&
    spread[0] === 1 && spread[1] === 0.5 && spread[2] === 3.5 && spread[3] === 2 &&
    suffix[0] === 0.5 && suffix[1] === 3.5 && suffix[2] === 1 && suffix[3] === 2;
}

export function negativeZero(signed: int32): number { const values = [signed, -0]; return values[1]; }
export function nativeFloat32(narrow: float32): float32 { const values = [narrow, 0.5]; return values[1]; }
export function fractionalFloat64(narrow: float32): number { const values = [narrow, 0.1]; return values[1]; }
export function wideExact(wide: int64) { const values = [wide, 1]; return values; }
export function widePair(wide: int64) { const values = [wide, wide]; return values; }
export function literalBoundary(signed: int32) { const values = [signed, 2147483648]; return values; }
export function spreadValues() { const numbers: number[] = [0.5, 3.5]; return [1, ...numbers, 2]; }
export function suffixValues() { const numbers: number[] = [0.5, 3.5]; return [...numbers, 1, 2]; }
let trace: int32 = 0;
function signedValue(): int32 { trace = trace * 10 + 1; return -7; }
function floatingValues(): number[] { trace = trace * 10 + 2; return [0.5]; }
function unsignedValue(): uint32 { trace = trace * 10 + 3; return 4294967295; }
export function effectOrder() {
  trace = 0;
  const values = [signedValue(), ...floatingValues(), unsignedValue()];
  return values;
}
export function effectTrace(): int32 { return trace; }
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
    for (const name of ["wideExact", "widePair"]) {
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${arrayType}<i64>`, "u").test(generated), true,
        `${name}: exact wide integer remains the inferred physical element`);
    }
    assert.equal(/i64_to_f64|u64_to_f64|\.to_vec\(|\.collect::<|Box::new/u.test(generated), false,
      "no wide rounding, intermediate collection, clone buffer or box");
    const resultType = `${arrayType}<f64>`;
    const allocationCount = lane === "native" ? 1 : 2;
    const nativeObservations = observed.map(([name, argumentsText, values]) =>
      `assert_dense(${name}(${argumentsText.replaceAll("4294967295", "u32::MAX")}), &[${values.map(value =>
        fractional.some(([candidate]) => candidate === name) && Number.isInteger(value) ? `${value}.0_f64` : String(value)).join(", ")}]);`).join("\n    ");
    const assertDense = lane === "native"
      ? `fn assert_dense<T: std::fmt::Debug + PartialEq>(actual: Vec<T>, expected: &[T]) {
    assert_eq!(actual.len(), expected.len());
    assert_eq!(actual.as_slice(), expected);
}`
      : `fn assert_dense<T: std::fmt::Debug + PartialEq + Clone>(actual: js_abi::JsArray<T>, expected: &[T]) {
    assert_eq!(actual.len(), expected.len());
    for (index, value) in expected.iter().enumerate() { assert_eq!(actual.get(index).as_ref(), Some(value)); }
}`;
    const initialize = artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : "";
    const checkedIndexResult = lane === "native" ? '.expect("native checked index succeeds")' : "";
    for (const [name, valueType] of [["verify", "bool"], ["negativeZero", "f64"], ["nativeFloat32", "f32"], ["fractionalFloat64", "f64"]]) {
      const expectedResultType = lane === "native" ? `Result<${valueType}, rt::TsonicError>` : valueType;
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${expectedResultType}`, "u").test(generated), true,
        `${name}: preserve the native checked-index result contract on the selected surface`);
    }
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
${assertDense}
#[test]
fn exact_values_widths_signed_zero_and_source_order() {
    ${initialize}
    assert!(verify()${checkedIndexResult});
    ${nativeObservations}
    assert_dense(wideExact(9_007_199_254_740_993_i64), &[9_007_199_254_740_993_i64, 1]);
    assert_dense(widePair(9_007_199_254_740_993_i64), &[9_007_199_254_740_993_i64, 9_007_199_254_740_993_i64]);
    assert_dense(literalBoundary(-7), &[-7.0_f64, 2_147_483_648.0_f64]);
    assert_dense(spreadValues(), &[1.0_f64, 0.5, 3.5, 2.0]);
    assert_dense(suffixValues(), &[0.5_f64, 3.5, 1.0, 2.0]);
    assert_eq!(negativeZero(-7)${checkedIndexResult}.to_bits(), (-0.0_f64).to_bits());
    assert_eq!(nativeFloat32(1.5_f32)${checkedIndexResult}.to_bits(), 0.5_f32.to_bits());
    assert_eq!(fractionalFloat64(1.5_f32)${checkedIndexResult}.to_bits(), 0.1_f64.to_bits());
    assert_dense(effectOrder(), &[-7.0_f64, 0.5, 4_294_967_295.0]);
    assert_eq!(effectTrace(), 123);
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
