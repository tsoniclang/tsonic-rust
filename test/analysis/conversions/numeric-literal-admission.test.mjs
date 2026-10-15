import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { compileRust } from "../../helpers/rust-session.mjs";

const header = `import type { float32, int32 } from "@tsonic/core/types.js";\n`;
const local = (type, expression) => `export function f(): ${type} {\n  const y: ${type} = ${expression};\n  return y;\n}\n`;
const surfaces = [["native", undefined], ["js", ["js"]]];

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
);

const finite = [
  ["float64 local 1.7976931348623157e308", local("number", "1.7976931348623157e308"), "let y: f64 = 1.7976931348623157e+308;"],
  ["float64 local -0", local("number", "-0"), "let y: f64 = -0.0;"],
  ["float64 local 5e-324", local("number", "5e-324"), "let y: f64 = 5e-324;"],
  ["float64 local 1e-400", local("number", "1e-400"), "let y: f64 = 0.0;"],
  ["float64 local 1e3", local("number", "1e3"), "let y: f64 = 1000.0;"],
  ["float64 local 1e21", local("number", "1e21"), "let y: f64 = 1e+21;"],
  ["float64 local -(2.5)", local("number", "-(2.5)"), "let y: f64 = -2.5;"],
  ["float32 local -0", local("float32", "-0"), "let y: f32 = -0.0_f32;"],
  ["float32 local 5e-324", local("float32", "5e-324"), "let y: f32 = 5e-324_f32;"],
  ["float32 local 1.5", local("float32", "1.5"), "let y: f32 = 1.5_f32;"],
];

function analyzeOnly(body, selected) {
  let analysis;
  let ast;
  const { result } = compileRust({ ...(selected === undefined ? {} : { surfaces: selected }), files: { "index.ts": header + body },
    compileTarget(request) {
      ast = request.input.source.ast;
      analysis = analyzeRustTargetProgram(request);
      return analysis.kind === "rejected" ? analysis : { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    },
  });
  return { analysis, ast, result };
}

for (const [surface, selected] of surfaces) {
  for (const [name, body] of nonFinite) {
    test(`${surface}: ${name} is refused by analysis before any Rust is planned`, () => {
      const { analysis, ast, result } = analyzeOnly(body, selected);
      assert.equal(analysis !== undefined, true, `${name}: the session invokes Rust analysis`);
      assert.equal(analysis.kind === "rejected", true, `${name}: analysis rejects the non-finite numeric literal`);
      const refusals = analysis.diagnostics.filter(entry => entry.code === "RUST_NUMERIC_LITERAL_NOT_FINITE");
      assert.equal(refusals.length === 1, true, `${name}: exactly one non-finite literal refusal`);
      assert.equal(analysis.diagnostics[0] === refusals[0], true, `${name}: the refusal is the first diagnostic`);
      assert.equal(refusals[0].message === "Numeric literal requires parseable finite source literal text from TSTS.", true,
        `${name}: the refusal states the finite source literal requirement`);
      assert.equal(refusals[0].category === "error", true, `${name}: the refusal is an error`);
      assert.equal(ast.kindName(refusals[0].sourceNode) === "KindNumericLiteral", true, `${name}: the refusal anchors to the numeric literal`);
      assert.equal(ast.text(refusals[0].sourceNode) === "Infinity", true, `${name}: TSTS literal text for 1e400 is the non-finite value`);
      assert.equal(result.artifacts.length === 0, true, `${name}: no Rust artifact is produced`);
    });
  }
  for (const [name, body, line] of finite) {
    test(`${surface}: ${name} keeps its exact finite Rust literal`, () => {
      const { result } = compileRust({ ...(selected === undefined ? {} : { surfaces: selected }), files: { "index.ts": header + body } });
      assert.equal(result.diagnostics.length === 0, true, `${name}: no diagnostics`);
      const rust = result.artifacts.filter(artifact => String(artifact.path).endsWith(".rs")).map(artifact => String(artifact.text)).join("\n");
      assert.equal(rust.split("\n").some(text => text.trim() === line), true, `${name}: emits ${line}`);
      assert.equal(rust.includes("Infinity"), false, `${name}: no non-finite spelling in generated Rust`);
    });
  }
}
