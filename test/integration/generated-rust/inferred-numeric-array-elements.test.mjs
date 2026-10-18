import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";

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
  ["literalWrapped", "[signed, unsigned, ((1))]", ["int32", "uint32", "float64"]],
];
const exactPhysicalForms = [
  ["outside", "4294967296", "4_294_967_296.0_f64"],
  ["boundary", "9007199254740992", "9_007_199_254_740_992.0_f64"],
  ["above", "9007199254740994", "9_007_199_254_740_994.0_f64"],
  ["long", (1n << 200n).toString(), "f64::from_bits(0x4c70_0000_0000_0000)"],
  ["radix", `0x${(1n << 200n).toString(16)}`, "f64::from_bits(0x4c70_0000_0000_0000)"],
].flatMap(([name, token, expected]) => [
  [`${name}Last`, `[signed, unsigned, ${token}]`, ["int32", "uint32", "float64"], expected],
  [`${name}Middle`, `[signed, ${token}, unsigned]`, ["int32", "float64", "uint32"], expected],
  [`${name}First`, `[${token}, signed, unsigned]`, ["float64", "int32", "uint32"], expected],
]);
const constructedPhysicalForms = [...physicalForms, ...exactPhysicalForms];

function physicalUnionInfo(generated, allGenerated, array, name, nativeTypes) {
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
  assert.equal(variants.size, nativeTypes.length, `${name}: exact original physical arm count`);
  for (const primitive of nativeTypes) assert.equal(variants.has(primitive), true, `${name}: ${primitive} payload`);
  return { carrier, enumPath, variants };
}

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`C130 ${lane}: physical integer unions preserve native payload values, cross-arm equality and exact cost`, { timeout: 300_000 }, () => {
    const files = { "index.ts": 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
      constructedPhysicalForms.map(([name, expression, names, literal]) => `
export function ${name}(signed: int32, unsigned: uint32) { const values = ${expression}; return values; }
${literal !== undefined ? "" : `export function ${name}Equal(signed: int32, unsigned: uint32): boolean {
  const values = ${expression};
  return ${names.slice(1).map((_, index) =>
    `values[0] === values[${index + 1}] && !(values[0] !== values[${index + 1}])`).join(" && ")};
}`}`).join("\n") };
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_arrays" } }, files });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 8).map(row => `${row.code}: ${row.message}`).join("\n"));
    const generated = artifactText(result, "src/index.rs");
    const allGenerated = result.artifacts.map(artifact => artifact.text).join("\n");
    const array = lane === "native" ? "Vec" : "js_abi::JsArray";
    const nativeType = { int32: "i32", uint32: "u32", float64: "f64" };
    const cases = constructedPhysicalForms.map(([name, , names, literal]) => {
      const { carrier, enumPath, variants } = physicalUnionInfo(generated, allGenerated, array, name, names.map(primitive => nativeType[primitive]));
      const entries = names.map(primitive => `${enumPath}::${variants.get(nativeType[primitive])}(${primitive === "int32"
        ? "signed" : primitive === "uint32" ? "unsigned" : literal ?? "1.0_f64"})`).join(", ");
      const resultType = `${array}<${carrier}>`;
      const constructor = lane === "native" ? `vec![${entries}]` : `js_abi::JsArray::from_dense(vec![${entries}])`;
      const value = lane === "native" ? "&value[index]" : '&value.get(index).expect("a constructed dense element exists")';
      const arms = [...variants].map(([primitive, variant]) => `${enumPath}::${variant}(payload) => ${primitive === "f64"
        ? "*payload" : "f64::from(*payload)"}`).join(", ");
      const expected = names.map(primitive => primitive === "int32" ? "-1.0_f64" : primitive === "uint32"
        ? "4_294_967_295.0_f64" : literal ?? "1.0_f64").join(", ");
      return `
fn handwritten_${name.toLowerCase()}(signed: i32, unsigned: u32) -> ${resultType} { ${constructor} }
fn check_${name.toLowerCase()}() {
    let value = ${name}(-1, u32::MAX);
    assert_eq!(value.len(), ${names.length});
    for (index, expected) in [${expected}].into_iter().enumerate() {
        let actual = match ${value} { ${arms} };
        assert_eq!(actual.to_bits(), expected.to_bits());
    }
    ${literal !== undefined ? "" : `assert!(${name}Equal(1, 1)${lane === "native" ? '.expect("checked source reads succeed")' : ""});
    assert!(!${name}Equal(-1, u32::MAX)${lane === "native" ? '.expect("distinct checked source reads succeed")' : ""});`}
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
    ${constructedPhysicalForms.map(([name]) => `check_${name.toLowerCase()}();`).join("\n    ")}
}
}
`;
    const root = writeGeneratedProject(`physical-numeric-arrays-${lane}`, result.artifacts.map(artifact =>
      artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + proof } : artifact));
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt"]);
    runCargo(root, ["fmt", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const checked = runCargo(root, ["test", "--locked", "--offline", "--", "--nocapture"]);
    process.stdout.write(checked.stdout + checked.stderr);
  });
}

const operationControls = [
  ["number read", "const value: number = values[0]; return value === 1;"],
  ["order", "return !(values[0] < values[1]);"],
  ["addition", "return values[0] + values[1] === 2;"],
  ["Object.is", "return Object.is(values[0], values[1]);"],
  ["Math.max", "return Math.max(values[0], values[1]) === 1;"],
  ["includes", "const first = [values[0]]; return first.includes(values[1]);"],
  ["indexOf", "return values.indexOf(values[1]) === 0;"],
  ["Set", "const keys = new Set(values); return keys.has(values[1]) && keys.size === 1;"],
  ["Map", "const keys = new Map<number, boolean>(); keys.set(values[0], true); return keys.has(values[1]);"],
  ["String", 'return String(values[0]) === "1" && String(values[1]) === "1";'],
  ["template", 'return `${values[0]}:${values[1]}` === "1:1";'],
  ["JSON", 'return JSON.stringify(values) === EXPECTED_JSON;'],
  ["sort", 'values.sort(); return JSON.stringify(values) === EXPECTED_SORT;'],
];

function operationRefusals(operation, names) {
  const types = ["int32", "uint32", "float64"].filter(name => names.includes(name)).map(rustSourcePrimitiveTargetType);
  const carrier = rustSourceUnionTargetType("/src/index.ts", `Union${types.length}`, [], "generated", { kind: "physical", types });
  const carrierText = JSON.stringify(carrier);
  const selectedCall = (member, span) => ({ code: "RUST_SELECTED_OPERATION_UNSUPPORTED",
    message: `The selected JavaScript call '${member}' has no closed Rust operation row for the selected receiver and argument carriers.`,
    evidence: ["target.capability=rust.selected-operation"], span });
  switch (operation) {
    case "number read": return [{ code: "RUST_INITIALIZER_CARRIER_MISMATCH",
      message: "The initializer cannot be represented by the declaration's exact Rust carrier.",
      evidence: ["target.capability=rust.initializer-carrier"], span: "values[0]" }];
    case "order":
    case "addition": {
      const operator = operation === "order" ? "KindLessThanToken" : "KindPlusToken";
      return [{ code: "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED",
        message: `Checked binary operator '${operator}' has no closed Rust operation for the finalized operand carriers.`,
        evidence: ["target.capability=rust.operation.binary", `source.operatorKind=${operator}`,
          `left=${carrierText}`, `right=${carrierText}`], span: `values[0] ${operation === "order" ? "<" : "+"} values[1]` }];
    }
    case "Math.max": return [{ code: "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED",
      message: "The TSTS-selected call argument cannot be represented by the selected Rust target parameter carrier.",
      evidence: ["target.capability=rust.selected-operation", `sourceArgumentIndex=0; actual=${carrierText}; expected=${
        JSON.stringify(rustSourcePrimitiveTargetType("float64"))}`], span: "Math.max(values[0], values[1])" }];
    case "includes": return [selectedCall("Array.includes", "first.includes(values[1])")];
    case "indexOf": return [selectedCall("Array.indexOf", "values.indexOf(values[1])")];
    case "Set": return [{ code: "RUST_SELECTED_OPERATION_UNSUPPORTED",
      message: "The selected JavaScript constructor 'SetConstructor' has no closed Rust operation row for the selected argument carriers.",
      evidence: ["target.capability=rust.selected-operation", `arguments=${JSON.stringify([rustJsArrayTargetType(carrier)])}; selectedTypeArguments=${
        JSON.stringify([rustSourcePrimitiveTargetType("float64")])}`], span: "new Set(values)" },
    selectedCall("ReadonlySet.has", "keys.has(values[1])")];
    case "Map": return [selectedCall("Map.set", "keys.set(values[0], true)"), selectedCall("ReadonlyMap.has", "keys.has(values[1])")];
    case "template": return [{ code: "RUST_TEMPLATE_SUBSTITUTION_UNSUPPORTED",
      message: "Template substitution requires an exact closed primitive, string, or undefined carrier.",
      evidence: ["target.capability=rust.syntax.template", `substitution.carrier=${carrierText}`], span: "values[0]}:${" }];
    case "sort": return [selectedCall("Array.sort", "values.sort()")];
    case "Object.is":
    case "String":
    case "JSON": return [];
    default: return assert.fail(`Every operation control requires one frozen native disposition: ${operation}`);
  }
}

for (const [formName, form, names] of physicalForms.filter(([name]) => name !== "reverse" && name !== "literalWrapped")) {
  for (const [operation, body] of operationControls) {
    test(`C130 js: ${formName} ${operation} uses native number semantics or a precise pre-seal refusal`, { timeout: 300_000 }, () => {
      const expectedJson = names.length === 2 ? "[1,1]" : "[1,1,1]";
      const expectedSort = names.length === 2 ? "[10,2]" : "[1,10,2]";
      const source = 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
        `export function check(signed: int32, unsigned: uint32): boolean { const values = ${form}; ` +
        body.replace("EXPECTED_JSON", JSON.stringify(expectedJson)).replace("EXPECTED_SORT", JSON.stringify(expectedSort)) + " }";
      const { result, source: checkedSource } = compileRust({ surfaces: ["js"],
        target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_operation" } }, files: { "index.ts": source } });
      const issues = result.diagnostics.filter(issue => issue.category === "error");
      const expected = operationRefusals(operation, names);
      assert.equal(issues.length, expected.length, `${operation}: preserve the frozen accepted/refused disposition and every rejection`);
      if (expected.length !== 0) {
        assert.equal(result.program === undefined && result.plan === undefined, true,
          "the actual compilation observer publishes neither a program nor a plan");
        assert.equal(result.artifacts.length, 0, "an unsupported physical-union operation emits no target source");
        for (const [index, issue] of issues.entries()) {
          const refusal = expected[index];
          assert.equal(issue.code, refusal.code, `${operation}: exact original deciding owner`);
          assert.equal(issue.message, refusal.message, `${operation}: exact original cause`);
          assert.deepEqual(issue.evidence, refusal.evidence, `${operation}: exact carrier and operation evidence`);
          assert.equal(issue.sourceNode !== undefined, true, `${operation}: an actual source diagnostic`);
          const range = checkedSource.ast.authoredRange(issue.sourceNode);
          const text = checkedSource.ast.getSourceText(checkedSource.ast.getSourceFile(issue.sourceNode));
          assert.equal(range.kind === "authored" && range.start === source.indexOf(refusal.span) &&
            range.end === range.start + refusal.span.length && text.slice(range.start, range.end) === refusal.span, true,
          `${operation}: exact original source span, not an enclosing or contained unrelated operation`);
        }
        process.stdout.write(`C130 ${formName} ${operation}: PRESEAL ${issues.map(issue => issue.code).join(",")}\n`);
        return;
      }
      assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length > 0, true,
        "an admitted operation cannot regress to any substitute refusal");
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
    assert!(!check(-1, u32::MAX)${checkedResult});
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
export function widePreciseLiteral(wide: int64) { const values = [wide, 9007199254740993]; return values; }
export function genuineFloatWidth(narrow: float32, wide: int64) { const values = [narrow, wide]; return values; }
export function reverseGenuineFloatWidth(narrow: float32, wide: int64) { const values = [wide, narrow]; return values; }
export function literalBoundary(signed: int32) { const values = [signed, 2147483648]; return values; }
export function explicitInexact(signed: int32, unsigned: uint32): number[] { const values = [signed, unsigned, 9007199254740993]; return values; }
export function negativeZeroPeers(signed: int32, unsigned: uint32) { const values = [signed, unsigned, -0]; return values; }
export function computedFloatPeers(signed: int32, unsigned: uint32, computed: number) { const values = [signed, unsigned, computed]; return values; }
export function literalBeyondFloat32(narrow: float32) { const values = [narrow, 16777217]; return values; }
export function contextualFloat32(signed: int32, narrow: float32): float32[] { const values = [signed, narrow]; return values; }
export function contextualFloat64(signed: int32, narrow: float32): number[] { const values = [signed, narrow]; return values; }
type NativeValues = float32[];
function nativeArgument(values: NativeValues): NativeValues { return values; }
export function contextualArgument(signed: int32, narrow: float32): NativeValues { const values = [signed, narrow]; return nativeArgument(values); }
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
    for (const name of ["wideExact", "widePair", "widePreciseLiteral"]) {
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
    const genuineChecks = [["genuineFloatWidth", false], ["reverseGenuineFloatWidth", true]].map(([name, reverse]) => {
      const { carrier, enumPath, variants } = physicalUnionInfo(generated, result.artifacts.map(artifact => artifact.text).join("\n"),
        arrayType, name, ["f32", "i64"]);
      const entries = [`${enumPath}::${variants.get("f32")}(narrow)`, `${enumPath}::${variants.get("i64")}(wide)`];
      if (reverse) entries.reverse();
      const construction = lane === "native" ? `vec![${entries.join(", ")}]` : `js_abi::JsArray::from_dense(vec![${entries.join(", ")}])`;
      const narrowIndex = reverse ? 1 : 0;
      const wideIndex = reverse ? 0 : 1;
      const selected = index => lane === "native" ? `&value[${index}]`
        : `&value.get(${index}).expect("an existing native-width payload exists")`;
      return `{
    fn handwritten(narrow: f32, wide: i64) -> ${arrayType}<${carrier}> { ${construction} }
    let value = ${name}(-0.0_f32, 9_007_199_254_740_993_i64);
    assert_eq!(value.len(), 2);
    match ${selected(narrowIndex)} {
        ${enumPath}::${variants.get("f32")}(payload) => assert_eq!(payload.to_bits(), (-0.0_f32).to_bits()),
        _ => panic!("the f32 physical arm changed"),
    }
    match ${selected(wideIndex)} {
        ${enumPath}::${variants.get("i64")}(payload) => assert_eq!(*payload, 9_007_199_254_740_993_i64),
        _ => panic!("the exact i64 physical arm changed"),
    }
    for iteration in 0..1000 {
        let (value, cost) = measure(|| ${name}(std::hint::black_box(-0.0_f32), std::hint::black_box(9_007_199_254_740_993_i64)));
        let (expected, expected_cost) = measure(|| handwritten(std::hint::black_box(-0.0_f32), std::hint::black_box(9_007_199_254_740_993_i64)));
        assert_eq!(cost, expected_cost);
        assert_eq!(cost.allocations, ${allocationCount});
        assert_eq!(cost.reallocations, 0);
        if iteration == 0 { eprintln!("C130 ${lane} ${name}: {cost:?}"); }
        drop(value); drop(expected);
    }
}`;
    }).join("\n    ");
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
    assert_dense(widePreciseLiteral(9_007_199_254_740_995_i64), &[9_007_199_254_740_995_i64, 9_007_199_254_740_993_i64]);
    assert_dense(literalBoundary(-7), &[-7.0_f64, 2_147_483_648.0_f64]);
    assert_dense(explicitInexact(-7, u32::MAX), &[-7.0_f64, 4_294_967_295.0_f64, 9_007_199_254_740_992.0_f64]);
    assert_dense(computedFloatPeers(-7, u32::MAX, 0.1_f64), &[-7.0_f64, 4_294_967_295.0_f64, 0.1_f64]);
    assert_dense(literalBeyondFloat32(0.5_f32), &[0.5_f64, 16_777_217.0_f64]);
    assert_dense(contextualFloat32(16_777_217, 0.5_f32), &[16_777_216.0_f32, 0.5_f32]);
    assert_dense(contextualFloat64(16_777_217, 0.5_f32), &[16_777_217.0_f64, 0.5_f64]);
    assert_dense(contextualArgument(16_777_217, 0.5_f32), &[16_777_216.0_f32, 0.5_f32]);
    let negative_zero_values = negativeZeroPeers(-7, u32::MAX);
    let negative_zero = ${lane === "native" ? "negative_zero_values[2]" : 'negative_zero_values.get(2).expect("dense signed zero exists")'};
    assert_eq!(negative_zero.to_bits(), (-0.0_f64).to_bits());
    assert_dense(spreadValues(), &[1.0_f64, 0.5, 3.5, 2.0]);
    assert_dense(suffixValues(), &[0.5_f64, 3.5, 1.0, 2.0]);
    assert_eq!(negativeZero(-7)${checkedIndexResult}.to_bits(), (-0.0_f64).to_bits());
    assert_eq!(nativeFloat32(1.5_f32)${checkedIndexResult}.to_bits(), 0.5_f32.to_bits());
    assert_eq!(fractionalFloat64(1.5_f32)${checkedIndexResult}.to_bits(), 0.1_f64.to_bits());
    assert_dense(effectOrder(), &[-7.0_f64, 0.5, 4_294_967_295.0]);
    assert_eq!(effectTrace(), 123);
    ${genuineChecks}
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
    runCargo(root, ["fmt", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const checked = runCargo(root, ["test", "--locked", "--offline", "--", "--nocapture"]);
    process.stdout.write(checked.stdout + checked.stderr);
  });
}
