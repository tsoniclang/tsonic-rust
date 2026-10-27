import assert from "node:assert/strict";

import { appendFileSync } from "node:fs";

import { join } from "node:path";

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

export {
  fractional,
  integer,
  declarations,
  observed,
  verificationBindings,
  verification,
  physicalForms,
  exactPhysicalForms,
  constructedPhysicalForms,
  physicalUnionInfo,
  operationControls,
  operationRefusals,
  source,
};
