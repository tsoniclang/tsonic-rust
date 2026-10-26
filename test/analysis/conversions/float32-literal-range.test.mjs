import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/index.js";
import { compileRustTarget } from "../../../dist/backend/compile.js";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

const header = 'import type { float32, int8 } from "@tsonic/core/types.js";\n';
const surfaces = [["native", []], ["js", ["js"]]];
const rangeCode = "RUST_NUMERIC_LITERAL_OUT_OF_RANGE";
const local = value => `export function read(): float32 {\n  const value: float32 = ${value};\n  return value;\n}`;
const refused = [
  ["local overflow", local("3.5e38"), "3.5e38"],
  ["next canonical value above the rounding boundary", local("3.402823567797337e38"), "3.402823567797337e38"],
  ["exact authored overflow midpoint", local("340282356779733661637539395458142568448"), "340282356779733661637539395458142568448"],
  ["exact authored integer above midpoint", local("340282356779733661637539395458142568449"), "340282356779733661637539395458142568449"],
  ["exact authored decimal overflow midpoint", local("3.40282356779733661637539395458142568448e38"), "3.40282356779733661637539395458142568448e38"],
  ["exact authored decimal above midpoint", local("3.40282356779733661637539395458142568449e38"), "3.40282356779733661637539395458142568449e38"],
  ["largest finite float64", local("1.7976931348623157e308"), "1.7976931348623157e308"],
  ["decimal exponent overflow", local("1e39"), "1e39"],
  ["integer spelling of 2^128", local("340282366920938463463374607431768211456"), "340282366920938463463374607431768211456"],
  ["negative overflow", local("-3.5e38"), "3.5e38"],
  ["parenthesized negative overflow", local("-(3.5e38)"), "3.5e38"],
  ["unary plus overflow", local("+3.5e38"), "3.5e38"],
  ["parenthesized overflow", local("(3.5e38)"), "3.5e38"],
  ["return", "export function read(): float32 {\n  return 3.5e38;\n}", "3.5e38"],
  ["argument", "function id(value: float32): float32 { return value; }\nexport function read(): float32 { return id(3.5e38); }", "3.5e38"],
  ["typed array", "export function read(): float32[] { const values: float32[] = [3.5e38]; return values; }", "3.5e38"],
  ["assignment", "export function read(): float32 { let value: float32 = 1; value = 3.5e38; return value; }", "3.5e38"],
  ["conditional branch", "export function read(flag: boolean, value: float32): float32 { return flag ? 3.5e38 : value; }", "3.5e38"],
  ["nullable local", "export function read(): float32 | undefined { const value: float32 | undefined = 3.5e38; return value; }", "3.5e38"],
  ["property", "export function read(): { value: float32 } { return { value: 3.5e38 }; }", "3.5e38"],
  ["class field", "export class Box { value: float32 = 3.5e38; }", "3.5e38"],
  ["default argument", "export function read(value: float32 = 3.5e38): float32 { return value; }", "3.5e38"],
  ["compound assignment", "export function read(value: float32): float32 { let result: float32 = value; result += 3.5e38; return result; }", "3.5e38"],
  ["element assignment", "export function read(values: float32[]): void { values[0] = 3.5e38; }", "3.5e38"],
  ["generic argument", "function id<T>(value: T): T { return value; }\nexport function read(): float32 { return id<float32>(3.5e38); }", "3.5e38"],
  ["tuple element", "export function read(): [float32, float32] { return [3.5e38, 1]; }", "3.5e38"],
  ["arrow return", "export function read(): float32 { const next = (): float32 => 3.5e38; return next(); }", "3.5e38"],
  ["switch case", "export function read(value: float32): number { switch (value) { case 3.5e38: return 1; default: return 0; } }", "3.5e38"],
  ["interface property", "interface Box { value: float32 }\nexport function read(): float32 { const box: Box = { value: 3.5e38 }; return box.value; }", "3.5e38"],
  ["satisfies", local("3.5e38 satisfies float32"), "3.5e38"],
  ["const assertion", local("3.5e38 as const"), "3.5e38"],
  ["inferred array after a float32", "export function read(value: float32): float32[] { const values = [value, 3.5e38]; return values; }", "3.5e38"],
];
const accepted = [
  ["3.4028235e38", "0x7f7fffff"],
  ["3.4028234663852886e38", "0x7f7fffff"],
  ["3.4028235677973366e38", "0x7f7fffff"],
  ["-3.4028235677973366e38", "0xff7fffff"],
  ["340282356779733661637539395458142568447", "0x7f7fffff"],
  ["3.40282356779733661637539395458142568447e38", "0x7f7fffff"],
  ["1e-50", "0"],
  ["-1e-50", "0x80000000"],
  ["1.401298464324817e-45", "1"],
  ["1e-46", "0"],
  ["7.006492321624085e-46", "0"],
  ["7.006492321624087e-46", "1"],
  ["5e-324", "0"],
  ["-0", "0x80000000"],
  [".5", "0x3f000000"],
  ["1.", "0x3f800000"],
  ["0xF_F", "0x437f0000"],
  ["0b10_01", "0x41100000"],
  ["0o7_1", "0x42640000"],
  ["1_2.3_4E+0_2", "0x449a4000"],
  ["-(+0)", "0x80000000"],
  ["((.5))", "0x3f000000"],
  ["1e-9999999999999999999999999", "0"],
  ["1.00000005960464477539062499999999", "0x3f800000"],
  ["1.000000059604644775390625", "0x3f800000"],
  ["1.00000005960464477539062500000001", "0x3f800001"],
  ["1", "0x3f800000"],
  ["1.0", "0x3f800000"],
  ["0", "0"],
  ["0.000", "0"],
  ["0e0", "0"],
  ["0e9999999999999999999999999", "0"],
  ["-0.000", "0x80000000"],
];
const acceptedSource = header + accepted.map(([value], index) =>
  `export function value${index}(): float32 { const value: float32 = ${value}; return value; }`).join("\n") + `
export function wide(): number { const value: number = 3.5e38; return value; }
export function wideSum(value: float32): number { return value + 3.5e38; }
export function compare(value: float32): boolean { return value < 3.5e38; }
export function compareNegative(value: float32): boolean { return value > -3.5e38; }
export function equalWide(value: float32): boolean { return value === 3.5e38; }
export function grouped(flag: boolean): float32 { return flag ? ((.5)) : -(+1); }
function withDefault(value: float32 = 3.40282356779733661637539395458142568447e38): float32 { return value; }
export function defaultValue(): float32 { return withDefault(); }
export function inferred(value: float32): float32[] { const values = [value, 3.4028235677973366e38]; return values; }
export function integer(value: int8): int8[] { const values = [value, 1]; return values; }
`;

function analyzeOnly(source, selected) {
  let analysis;
  let ast;
  compileRust({ surfaces: selected, files: { "index.ts": source }, compileTarget(request) {
    ast = request.input.source.ast;
    analysis = analyzeRustAnalysisProgram(request);
    return analysis.kind === "rejected" ? analysis : { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  return { analysis, ast };
}

function assertAnchored(label, issue, ast, source, kind, text) {
  assert.equal(ast.kindName(issue.sourceNode) === kind, true, `${label}: anchors to ${kind}`);
  const range = ast.authoredRange(issue.sourceNode);
  const authored = ast.getSourceText(ast.getSourceFile(issue.sourceNode));
  assert.equal(range.kind === "authored" && range.start === source.indexOf(text, header.length) &&
    authored.slice(range.start, range.end) === text, true, `${label}: exact authored span ${text}`);
}

function assertNoArtifacts(label, source, selected, diagnostics) {
  const { result } = compileRust({ surfaces: selected, files: { "index.ts": source } });
  assert.equal(result.artifacts.length, 0, `${label}: rejection precedes publication`);
  assert.equal(JSON.stringify(result.diagnostics.map(({ code, message }) => [code, message])) ===
    JSON.stringify(diagnostics.map(({ code, message }) => [code, message])), true,
  `${label}: full compilation preserves exactly the analysis diagnostics`);
}

for (const [surface, selected] of surfaces) {
  for (const [name, body, literal] of refused) {
    test(`${surface}: selected float32 ${name} publishes one anchored range issue before sealing`, () => {
      const source = header + body;
      const { analysis, ast } = analyzeOnly(source, selected);
      assert.equal(analysis?.kind === "rejected", true, `${name}: source analysis rejects`);
      const followers = name === "default argument" ? ["RUST_DEFAULT_PARAMETER_INITIALIZER_CARRIER_UNSUPPORTED"]
        : name === "switch case" ? ["RUST_SWITCH_CASE_NOT_CLOSED"] : [];
      const leaders = surface === "js" && name === "element assignment" ? ["RUST_SELECTED_ASSIGNMENT_UNSUPPORTED"] : [];
      assert.deepEqual(analysis.diagnostics.map(issue => issue.code), [...leaders, rangeCode, ...followers],
        `${name}: complete ordered diagnostic list`);
      const issues = analysis.diagnostics.filter(issue => issue.code === rangeCode);
      assert.equal(issues.length, 1, `${name}: the selected failure is published exactly once`);
      const [issue] = issues;
      assert.equal(issue.message, "Numeric literal is outside the 'float32' range.", name);
      assert.equal(JSON.stringify(issue.evidence), '["target.carrier=float32"]', name);
      assert.equal(issue.source === "tsonic-rust" && issue.category === "error", true, name);
      assertAnchored(name, issue, ast, source, "KindNumericLiteral", literal);
      assertNoArtifacts(name, source, selected, analysis.diagnostics);
    });
  }

  test(`${surface}: an inferred int8 array transports its existing literal rejection once`, () => {
    const source = header + "export function read(value: int8): int8[] { const values = [value, 200]; return values; }";
    const { analysis, ast } = analyzeOnly(source, selected);
    assert.equal(analysis?.kind === "rejected", true, "integer admission rejects before sealing");
    assert.equal(analysis.diagnostics.length, 1, "exactly one issue, without a second carrier query");
    const [issue] = analysis.diagnostics;
    assert.equal(issue.code, "RUST_INTEGER_LITERAL_NOT_EXACT");
    assert.equal(issue.message, "Integer literal cannot be proven exact for the finalized Rust fixed-width carrier.");
    assert.equal(JSON.stringify(issue.evidence), '["target.carrier=int8"]');
    assertAnchored("int8", issue, ast, source, "KindNumericLiteral", "200");
    assertNoArtifacts("int8", source, selected, analysis.diagnostics);
  });

  test(`${surface}: a wide binary result is not silently narrowed to a float32 return`, () => {
    const source = header + "export function read(value: float32): float32 { return value + 3.5e38; }";
    const { analysis } = analyzeOnly(source, selected);
    assert.equal(analysis?.kind === "rejected", true, "the return destination cannot represent the wide operation");
    assert.deepEqual(analysis.diagnostics.map(issue => issue.code), ["RUST_RETURN_CARRIER_MISMATCH"],
      "the f64 literal remains valid; its result is refused by the return owner");
    assertNoArtifacts("wide result", source, selected, analysis.diagnostics);
  });

  test(`${surface}: a valid wide initializer retains its independent float32 mismatch`, () => {
    const source = header + `function wide(value: number): number { return value; }
export function read(): float32 { const value: float32 = wide(3.5e38); return value; }`;
    const { analysis, ast } = analyzeOnly(source, selected);
    assert.equal(analysis?.kind, "rejected", "a valid f64 source expression cannot initialize native f32 storage implicitly");
    assert.deepEqual(analysis.diagnostics.map(issue => issue.code), ["RUST_INITIALIZER_CARRIER_MISMATCH"],
      "the initializer owner refuses an admitted wide carrier, not an already refused numeric literal");
    const [issue] = analysis.diagnostics;
    assert.equal(issue.message, "The initializer cannot be represented by the declaration's exact Rust carrier.");
    assert.equal(JSON.stringify(issue.evidence), '["target.capability=rust.initializer-carrier"]');
    assert.equal(issue.source === "tsonic-rust" && issue.category === "error", true);
    assertAnchored("wide initializer", issue, ast, source, "KindCallExpression", "wide(3.5e38)");
    assertNoArtifacts("wide initializer", source, selected, analysis.diagnostics);
  });

  for (const value of ["3.5e38", "-3.5e38"]) {
    test(`${surface}: explicit ${value} as float32 remains owned by assertion admission`, () => {
      const expression = `${value} as float32`;
      const source = header + `export function read(): float32 { return ${expression}; }`;
      const { analysis, ast } = analyzeOnly(source, selected);
      assert.equal(analysis?.kind === "rejected", true, "assertion admission rejects");
      assert.deepEqual(analysis.diagnostics.map(issue => issue.code),
        ["RUST_ASSERTION_UNSUPPORTED", "RUST_RETURN_CARRIER_MISMATCH"], "complete assertion diagnostics");
      assert.equal(analysis.diagnostics.filter(issue => issue.code === rangeCode).length, 0,
        "the f64 source operand is not incorrectly admitted as an f32 literal");
      const issues = analysis.diagnostics.filter(issue => issue.code === "RUST_ASSERTION_UNSUPPORTED");
      assert.equal(issues.length, 1, "one assertion admission issue");
      assertAnchored(expression, issues[0], ast, source, "KindAsExpression", expression);
      assertNoArtifacts(expression, source, selected, analysis.diagnostics);
    });
  }

  test(`${surface}: native float32 tokens retain exact boundary bits and wide native operations`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": acceptedSource } });
    assert.equal(result.diagnostics.length === 0, true,
      `native accepted controls have no diagnostics: ${result.diagnostics.map(issue => issue.code).join(",")}`);
    const generated = result.artifacts.filter(artifact => String(artifact.path).endsWith(".rs"))
      .map(artifact => String(artifact.text)).join("\n");
    assert.equal(generated.includes("let value: f32 = 3.4028235677973366e+38;"), true, "keeps native rounded boundary token and native f32 storage");
    assert.equal(generated.includes("let value: f32 = 5e-324;"), true, "keeps permitted native underflow token and native f32 storage");
    assert.equal(generated.includes("let value: f64 = 3.5e+38;"), true, "does not narrow an f64 literal");
    assert.equal(generated.includes("let value: f32 = 340282356779733661637539395458142568447.0;"), true,
      "authored integer immediately below the overflow midpoint is not rounded through float64");
    assert.equal(generated.includes("let value: f32 = 3.40282356779733661637539395458142568447e+38;"), true,
      "authored decimal immediately below the overflow midpoint is preserved losslessly");
    const nativeTest = `#[test]
fn float32_values() {
    use tsonic_generated::index;
${accepted.map(([, bits], index) => `    assert_eq!(index::value${index}().to_bits(), ${bits});`).join("\n")}
    assert_eq!(index::wide(), 3.5e38_f64);
    assert_eq!(index::wideSum(1.0), 3.5e38_f64);
    assert!(index::compare(f32::MAX));
    assert!(!index::compare(f32::INFINITY));
    assert!(!index::compare(f32::NAN));
    assert!(index::compareNegative(-f32::MAX));
    assert!(!index::compareNegative(f32::NEG_INFINITY));
    assert!(!index::equalWide(f32::MAX));
    assert_eq!(index::grouped(true), 0.5_f32);
    assert_eq!(index::grouped(false), -1.0_f32);
    assert_eq!(index::defaultValue().to_bits(), 0x7f7fffff);
}
`;
    const projectRoot = writeGeneratedProject(`float32-literal-range-${surface}`, [
      ...result.artifacts.map(artifact => ({ path: String(artifact.path), text: String(artifact.text) })),
      { path: "tests/float32_values.rs", text: nativeTest },
    ]);
    runCargo(projectRoot, ["generate-lockfile", "--offline"]);
    runCargo(projectRoot, ["fmt", "--check"]);
    runCargo(projectRoot, ["build", "--all-targets", "--locked", "--offline"]);
    runCargo(projectRoot, ["test", "--locked", "--offline", "--test", "float32_values"]);
  });

  test(`${surface}: actual synthetic float64 literals retain value conversion instead of authored float32 retargeting`, { timeout: 300_000 }, () => {
    const source = header + "export function generated(): float32 { return 1.00000005960464477539062500000001; }";
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": source }, compileTarget(request) {
      const ast = request.input.source.ast;
      const synthetic = { ...ast, authoredRange(node) {
        return node !== undefined && ast.is.IsNumericLiteral(node) ? { kind: "synthetic" } : ast.authoredRange(node);
      } };
      return compileRustTarget({ ...request, input: { ...request.input, source: { ...request.input.source, ast: synthetic } } });
    } });
    assert.equal(result.diagnostics.length === 0, true,
      `synthetic input has no diagnostics: ${result.diagnostics.map(issue => issue.code).join(",")}`);
    const generated = result.artifacts.filter(artifact => String(artifact.path).endsWith(".rs")).map(artifact => String(artifact.text)).join("\n");
    assert.equal(generated.includes("1.0000000596046448_f64 as f32"), true,
      "the actual double is converted, not retargeted as an authored float32 token");
    const projectRoot = writeGeneratedProject(`float32-synthetic-value-${surface}`, [
      ...result.artifacts.map(artifact => ({ path: String(artifact.path), text: String(artifact.text) })),
      { path: "tests/synthetic_value.rs", text: `#[test]
fn synthetic_value() {
    assert_eq!(tsonic_generated::index::generated().to_bits(), 0x3f800000);
}
` },
    ]);
    runCargo(projectRoot, ["generate-lockfile", "--offline"]);
    runCargo(projectRoot, ["fmt", "--check"]);
    runCargo(projectRoot, ["build", "--all-targets", "--locked", "--offline"]);
    runCargo(projectRoot, ["test", "--locked", "--offline", "--test", "synthetic_value"]);
  });
}
