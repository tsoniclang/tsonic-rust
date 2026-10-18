import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceLiteralValues } from "@tsonic/target-api/source";
import { analyzeRustNumericLiteralAdmission } from "../../../dist/analysis/numeric/literal-admission.js";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

const header = `import type { float32, int32 } from "@tsonic/core/types.js";\n`;
const local = (type, expression) => `export function f(): ${type} {\n  const y: ${type} = ${expression};\n  return y;\n}\n`;
const surfaces = [["native", undefined], ["js", ["js"]]];
const refusal = Object.freeze({
  code: "RUST_NUMERIC_LITERAL_NOT_FINITE",
  message: "Numeric literal is not a finite double-precision value.",
  evidence: ["target.capability=rust.syntax.numeric-literal"],
});

const nonFinite = [];
for (const [type, label] of [["number", "float64"], ["float32", "float32"]]) {
  for (const expression of ["1e400", "-1e400", "(1e400)", "-(1e400)", "-(-1e400)"]) {
    nonFinite.push([`${label} local ${expression}`, local(type, expression)]);
  }
}
nonFinite.push(
  ["float64 return 1e400", "export function f(): number {\n  return 1e400;\n}\n"],
  ["float64 return (1e400)", "export function f(): number {\n  return (1e400);\n}\n"],
  ["float64 argument 1e400", "function g(v: number): number {\n  return v;\n}\nexport function f(): number {\n  return g(1e400);\n}\n"],
  ["float64 binary operand 1e400", "export function f(x: number): number {\n  return x * 1e400;\n}\n"],
  ["float64 comparison operand 1e400", "export function f(x: number): boolean {\n  return x < 1e400;\n}\n"],
  ["float64 array element 1e400", "export function f(): number[] {\n  return [1e400];\n}\n"],
  ["float64 default parameter 1e400", "export function f(v: number = 1e400): number {\n  return v;\n}\n"],
  ["untyped local 1e400", "export function f(): number {\n  const y = 1e400;\n  return y;\n}\n"],
  ["optional float64 local (1e400)", "export function f(): number | undefined {\n  const y: number | undefined = (1e400);\n  return y;\n}\n"],
  ["element index 1e400", "export function f(a: number[]): number {\n  return a[1e400];\n}\n"],
  ["switch case 1e400", "export function f(x: number): number {\n  switch (x) {\n    case 1e400:\n      return 1;\n    default:\n      return 0;\n  }\n}\n"],
  ["int32 local 1e400", local("int32", "1e400")],
  ["untyped array [1e400]", "export function f(): number[] {\n  const a = [1e400];\n  return a;\n}\n"],
  ["untyped array [1, 1e400]", "export function f(): number[] {\n  const a = [1, 1e400];\n  return a;\n}\n"],
  ["untyped array spread [...[1e400]]", "export function f(): number[] {\n  const a = [...[1e400]];\n  return a;\n}\n"],
  ["typed array spread [...[1e400]]", "export function f(): number[] {\n  const a: number[] = [...[1e400]];\n  return a;\n}\n"],
  ["typed array [1e400, -1e400]", "export function f(): number[] {\n  const a: number[] = [1e400, -1e400];\n  return a;\n}\n"],
  ["conditional branch 1e400", "export function f(flag: boolean): number {\n  return flag ? 1e400 : 0;\n}\n"],
  ["template substitution 1e400", "export function f(): string {\n  return `${1e400}`;\n}\n"],
  ["object property value 1e400", "export function f(): { v: number } {\n  return { v: 1e400 };\n}\n"],
  ["class field initializer 1e400", "export class C {\n  v: number = 1e400;\n}\n"],
  ["ambient const initializer 1e400", "declare const big = 1e400;\nexport function f(): number {\n  const y: number = big;\n  return y;\n}\n"],
  ["enum member initializer 1e400", "export enum E {\n  A = 1e400,\n}\nexport function f(): E {\n  return E.A;\n}\n"],
  ["computed object key [1e400]", "export function f(): number {\n  const o = { [1e400]: 1 };\n  return o.Infinity;\n}\n"],
  ["class computed key [1e400]", "export class C {\n  [1e400]: number = 1;\n}\n"],
  ["heritage call argument 1e400", "function base(n: number) {\n  return class {\n    value: number = n;\n  };\n}\nexport class C extends base(1e400) {}\n"],
  ["object literal property name 1e400", "export function f(): number {\n  const o = { 1e400: 1 };\n  return o.Infinity;\n}\n"],
  ["binding property name 1e400", "export function f(o: { Infinity: number }): number {\n  const { 1e400: v } = o;\n  return v;\n}\n"],
  ["class property name 1e400", "export class C {\n  1e400: number = 1;\n}\n"],
);
const jsOnlyNonFinite = [
  ["provider call argument 1e400", "export function f(): number {\n  return Math.max(1e400, 1);\n}\n"],
];
const typeSyntax = [
  ["negative literal type alias -1e400", "type NegBig = -1e400;\nexport function f(x: NegBig): number {\n  return x;\n}\n"],
  ["negative literal type in a union -1e400", "export function f(x: -1e400 | number): number {\n  return x;\n}\n"],
  ["type assertion to -1e400 | number", "export function f(x: number): number {\n  return x as -1e400 | number;\n}\n"],
];
const typeMemberKeys = [
  ["interface computed member key [1e400]", "interface Keyed {\n  [1e400]: number;\n}\nexport function f(): number {\n  return 1;\n}\n"],
  ["type literal computed member key [1e400]", "type Keyed = { [1e400]: number };\nexport function f(): number {\n  return 1;\n}\n"],
];
const declarationFileUse = "import { big } from \"./values.js\";\nexport function f(): number {\n  const y: number = big;\n  return y;\n}\n";

const accepted = [
  ["float64 local 1.7976931348623157e308", "number", "1.7976931348623157e308", "let y: f64 = 1.7976931348623157e+308_f64;"],
  ["float64 local -0", "number", "-0", "let y: f64 = -0.0_f64;"],
  ["float64 local 5e-324", "number", "5e-324", "let y: f64 = 5e-324_f64;"],
  ["float64 local 1e-400", "number", "1e-400", "let y: f64 = 1e-400_f64;"],
  ["float64 local 1e3", "number", "1e3", "let y: f64 = 1e+3_f64;"],
  ["float64 local 1e21", "number", "1e21", "let y: f64 = 1e+21_f64;"],
  ["float64 local -(2.5)", "number", "-(2.5)", "let y: f64 = -2.5_f64;"],
  ["float32 local -0", "float32", "-0", "let y: f32 = -0.0_f32;"],
  ["float32 local 5e-324", "float32", "5e-324", "let y: f32 = 5e-324_f32;"],
  ["float32 local 1.5", "float32", "1.5", "let y: f32 = 1.5_f32;"],
];
const acceptedSource = accepted.map(([, type, expression], index) =>
  `export function f${index}(): ${type} {\n  const y: ${type} = ${expression};\n  return y;\n}\n`).join("") +
  "type Big = 1e400;\n" +
  "export function typeParameter(x: 1e400): number {\n  return x;\n}\n" +
  "export function typeAlias(x: Big): number {\n  return x;\n}\n";

function surfaceOptions(selected) {
  return selected === undefined ? {} : { surfaces: selected };
}

function buildNatively(name, artifacts, nativeTest) {
  const projectRoot = writeGeneratedProject(name, [
    ...artifacts.map(artifact => ({ path: String(artifact.path), text: String(artifact.text) })),
    ...(nativeTest === undefined ? [] : [{ path: "tests/literal_values.rs", text: nativeTest }]),
  ]);
  runCargo(projectRoot, ["generate-lockfile", "--offline"]);
  runCargo(projectRoot, ["fmt", "--check"]);
  runCargo(projectRoot, ["build", "--all-targets", "--locked", "--offline"]);
  if (nativeTest !== undefined) runCargo(projectRoot, ["test", "--locked", "--offline", "--test", "literal_values"]);
}

function analyzeOnly(source, selected) {
  let analysis;
  let ast;
  compileRust({ ...surfaceOptions(selected), files: { "index.ts": source },
    compileTarget(request) {
      ast = request.input.source.ast;
      analysis = analyzeRustTargetProgram(request);
      return analysis.kind === "rejected" ? analysis : { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    },
  });
  return { analysis, ast };
}

function admissionOnly(source, selected) {
  let refusals;
  compileRust({ ...surfaceOptions(selected), files: { "index.ts": source },
    compileTarget(request) {
      const ast = request.input.source.ast;
      const files = request.input.source.sourceFiles.filter(file => file !== undefined && !ast.isDeclarationFile(file));
      refusals = analyzeRustNumericLiteralAdmission(ast, files, analyzeSourceLiteralValues(ast, files),
        node => files.includes(ast.getSourceFile(node)));
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    },
  });
  return refusals;
}

function literalOffsets(source) {
  const offsets = [];
  for (let index = source.indexOf("1e400"); index !== -1; index = source.indexOf("1e400", index + 1)) offsets.push(index);
  return offsets;
}

function assertRefused(name, source, selected) {
  const { analysis, ast } = analyzeOnly(source, selected);
  assert.equal(analysis !== undefined, true, `${name}: the session invokes Rust analysis`);
  assert.equal(analysis.kind === "rejected", true, `${name}: analysis rejects the program`);
  const offsets = literalOffsets(source);
  const codes = analysis.diagnostics.map(entry => entry.code);
  assert.equal(JSON.stringify(codes) === JSON.stringify(offsets.map(() => refusal.code)), true,
    `${name}: the complete diagnostic list is one refusal per non-finite literal: ${JSON.stringify(codes)}`);
  analysis.diagnostics.forEach((entry, index) => {
    const label = `${name}: refusal ${index}`;
    assert.equal(entry.message === refusal.message, true, `${label} states the finite double-precision condition`);
    assert.equal(JSON.stringify(entry.evidence) === JSON.stringify(refusal.evidence), true, `${label} carries the numeric-literal evidence`);
    assert.equal(entry.category === "error" && entry.source === "tsonic-rust", true, `${label} is a tsonic-rust error`);
    assert.equal(ast.kindName(entry.sourceNode) === "KindNumericLiteral", true, `${label} anchors to the numeric literal`);
    const range = ast.authoredRange(entry.sourceNode);
    const text = ast.getSourceText(ast.getSourceFile(entry.sourceNode));
    assert.equal(range.kind === "authored" && range.start === offsets[index] && text.slice(range.start, range.end) === "1e400", true,
      `${label} spans the authored literal at offset ${offsets[index]}`);
  });
  const { result } = compileRust({ ...surfaceOptions(selected), files: { "index.ts": source } });
  assert.equal(result.artifacts.length === 0, true, `${name}: the full compilation publishes no artifact`);
  assert.equal(JSON.stringify(result.diagnostics.map(({ code, message }) => [code, message])) ===
    JSON.stringify(analysis.diagnostics.map(({ code, message }) => [code, message])), true,
  `${name}: the full compilation reports exactly the analysis refusals`);
}

for (const [surface, selected] of surfaces) {
  const forms = surface === "js" ? [...nonFinite, ...jsOnlyNonFinite] : nonFinite;
  for (const [name, body] of forms) {
    test(`${surface}: ${name} is refused by numeric literal admission before carrier analysis`, () => {
      assertRefused(name, header + body, selected);
    });
  }
  test(`${surface}: finite literals and literal type positions compile natively with exact Rust literals`, () => {
    const { result } = compileRust({ ...surfaceOptions(selected), files: { "index.ts": header + acceptedSource } });
    assert.equal(result.diagnostics.length === 0, true, `${surface}: no diagnostics: ${JSON.stringify(result.diagnostics.map(entry => entry.code))}`);
    const rust = result.artifacts.filter(artifact => String(artifact.path).endsWith(".rs")).map(artifact => String(artifact.text));
    const lines = rust.join("\n").split("\n").map(line => line.trim());
    for (const [name, , , line] of accepted) {
      assert.equal(lines.includes(line), true, `${name}: emits ${line}`);
    }
    assert.equal(lines.some(line => /Infinity\.0|Infinity_f32|f64::INFINITY/u.test(line)), false, `${surface}: no non-finite float literal in generated Rust`);
    buildNatively(`numeric-literal-admission-${surface}`, result.artifacts, `#[test]
fn native_literal_values() {
    use tsonic_generated::index;
    assert_eq!(index::f0(), f64::MAX);
    assert_eq!(index::f1().to_bits(), (-0.0_f64).to_bits());
    assert_eq!(index::f2().to_bits(), 1);
    assert_eq!(index::f3().to_bits(), 0);
    assert_eq!(index::f4(), 1000.0_f64);
    assert_eq!(index::f5(), 1e21_f64);
    assert_eq!(index::f6(), -2.5_f64);
    assert_eq!(index::f7().to_bits(), (-0.0_f32).to_bits());
    assert_eq!(index::f8().to_bits(), 0);
    assert_eq!(index::f9(), 1.5_f32);
}
`);
  });
  typeSyntax.forEach(([name, body], index) => {
    test(`${surface}: ${name} is type syntax and compiles natively without a refusal`, () => {
      const { result } = compileRust({ ...surfaceOptions(selected), files: { "index.ts": header + body } });
      assert.equal(result.diagnostics.length === 0, true, `${name}: no diagnostics: ${JSON.stringify(result.diagnostics.map(entry => entry.code))}`);
      assert.equal(result.artifacts.length > 0, true, `${name}: the compilation publishes its project`);
      buildNatively(`numeric-literal-admission-type-${index}-${surface}`, result.artifacts);
    });
  });
  for (const [name, body] of typeMemberKeys) {
    test(`${surface}: ${name} is type syntax that numeric literal admission does not enter`, () => {
      const refusals = admissionOnly(header + body, selected);
      assert.equal(refusals !== undefined && refusals.length === 0, true,
        `${name}: no admission refusal: ${JSON.stringify(refusals?.map(entry => entry.code))}`);
    });
  }
  test(`${surface}: a non-finite literal in a declaration file is outside admission and never reaches carrier resolution`, () => {
    const { result } = compileRust({ ...surfaceOptions(selected), files: { "index.ts": header + declarationFileUse,
      "values.d.ts": "export declare const big = 1e400;\n" } });
    const codes = result.diagnostics.map(entry => entry.code);
    assert.equal(codes.includes(refusal.code), false, `declaration file: no admission refusal: ${JSON.stringify(codes)}`);
    assert.equal(codes.some(code => /INVARIANT/u.test(code)), false, `declaration file: no analysis invariant: ${JSON.stringify(codes)}`);
  });
}
