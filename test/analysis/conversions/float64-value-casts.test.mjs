import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { compileRustTarget } from "../../../dist/backend/compile.js";
import { selectRustKnownNumericValueConversion, selectRustSourceAssertionConversion,
  selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { selectedSourceLiteralIsRepresentable } from "../../../dist/policy/types/resolution/selected-numeric-literal.js";

const header = 'import type { float32, float64 } from "@tsonic/core/types.js";\n';
const midpoint = "1.00000005960464477539062500000001";
const sourceCarrier = rustSourcePrimitiveTargetType("float64");
const targetCarrier = rustSourcePrimitiveTargetType("float32");

function compile(body, surfaces, synthetic = false) {
  const observed = [];
  const { result } = compileRust({ surfaces, files: { "index.ts": header + body }, compileTarget(request, observer) {
    const original = request.input.source.ast;
    const ast = !synthetic ? original : { ...original, authoredRange(node) {
      return node !== undefined && original.is.IsNumericLiteral(node) ? { kind: "synthetic" } : original.authoredRange(node);
    } };
    return compileRustTarget({ ...request, input: { ...request.input, source: { ...request.input.source, ast } } }, {
      ...observer, analyzed(program) {
        observer?.analyzed?.(program);
        const visit = node => {
          const kind = ast.kindName(node);
          if (kind === "KindNumericLiteral" || kind === "KindAsExpression") {
            observed.push({ kind, source: program.records.runtimeCarrier.get(node)?.carrier,
              literal: program.records.literalValue.get(node),
              contextual: program.records.contextualValueConversion.get(node),
              operation: program.records.targetOperation.get(node) });
          }
          ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
        };
        for (const file of program.sourceFiles) if (ast.getFileName(file) === "/src/index.ts") visit(file);
      },
    });
  } });
  const text = result.artifacts.filter(artifact => String(artifact.path).endsWith(".rs"))
    .map(artifact => String(artifact.text)).join("\n");
  return { result, text, observed };
}

function assertAccepted(compilation) {
  assert.equal(compilation.result.diagnostics.length, 0,
    `no diagnostics: ${compilation.result.diagnostics.map(issue => issue.code).join(",")}`);
  assert.equal(compilation.text.length > 0, true, "native artifacts published");
}

test("explicit and known-value float64 casts do not broaden literal candidates or implicit promotion", () => {
  const conversion = selectRustSourceAssertionConversion(sourceCarrier, targetCarrier, undefined);
  assert.deepEqual(conversion, { kind: "semantic-conversion", id: "native-f64-to-f32" });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "native-numeric-cast", sourceMode: "value", source: sourceCarrier, target: targetCarrier,
    lowering: "numeric-cast", targetType: "f32", fallible: false,
  });
  assert.equal(selectRustSourceValueConversion(sourceCarrier, targetCarrier), undefined, "no implicit typed narrowing");
  assert.equal(selectRustKnownNumericValueConversion(sourceCarrier, targetCarrier, undefined), undefined);
  const authored = { form: "numeric", numeric: { kind: "authored", token: {
    coefficient: 1n, exponent: 40n, negative: false, decimalText: "1e+40",
  } } };
  assert.equal(selectRustSourceAssertionConversion(sourceCarrier, targetCarrier, authored), undefined,
    "failed authored retarget is not an actual f64 value");
  assert.equal(selectRustKnownNumericValueConversion(sourceCarrier, targetCarrier, authored), undefined);
  const checked = { form: "numeric", numeric: { kind: "checked-float64", value: 1e40 } };
  assert.equal(selectedSourceLiteralIsRepresentable(checked, "float32"), false, "candidate finite rule is unchanged");
  assert.deepEqual(selectRustKnownNumericValueConversion(sourceCarrier, targetCarrier, checked), conversion);
});

for (const [surface, surfaces] of [["native", []], ["js", ["js"]]]) {
  test(`${surface}: typed float64 parameters use one explicit native float32 cast`, () => {
    const compilation = compile("export function narrow(pending: float64): float32 { return pending as float32; }", surfaces);
    assertAccepted(compilation);
    assert.equal(compilation.text.includes("pending as f32"), true, "native value operation");
    const assertions = compilation.observed.filter(row => row.kind === "KindAsExpression");
    assert.equal(assertions.length, 1);
    assert.equal(assertions[0].operation?.conversion?.id === "native-f64-to-f32", true, "sealed explicit conversion");
  });

  for (const token of [midpoint, "1e40", "-1e40", "-0"]) {
    test(`${surface}: typed float64 local ${token} preserves its source before explicit float32 narrowing`, () => {
      const compilation = compile(`export function narrow(): float32 { const pending: float64 = ${token}; return pending as float32; }`, surfaces);
      assertAccepted(compilation);
      assert.equal(compilation.text.includes("pending as f32"), true, "one native narrowing");
      assert.equal(compilation.observed.filter(row => row.kind === "KindNumericLiteral")
        .every(row => row.source?.kind === "source-primitive" && row.source.name === "float64"), true,
      "native producer stays f64");
      assert.equal(compilation.text.includes("_f64"), true, "source syntax pins the native source precision");
    });
  }

  test(`${surface}: nested explicit float64 midpoint retains source precision when its identity assertion is elided`, () => {
    const compilation = compile(`export function narrow(): float32 { return (${midpoint} as float64) as float32; }`, surfaces);
    assertAccepted(compilation);
    assert.equal(compilation.text.includes(`${midpoint}_f64 as f32`), true, "no f32 re-inference under the native cast");
  });

  for (const [name, body] of [
    ["return", "export function narrow(): float32 { return 1e40; }"],
    ["local", "export function narrow(): float32 { const pending: float32 = 1e40; return pending; }"],
    ["argument", "function take(pending: float32): float32 { return pending; } export function narrow(): float32 { return take(1e40); }"],
    ["optional", "export function narrow(): float32 | undefined { const pending: float32 | undefined = 1e40; return pending; }"],
    ["midpoint", `export function narrow(): float32 { return ${midpoint}; }`],
    ["negative-zero", "export function narrow(): float32 { return -0; }"],
  ]) {
    test(`${surface}: checked float64 ${name} seals its selected float32 adaptation without relabelling source storage`, () => {
      const compilation = compile(body, surfaces, true);
      assertAccepted(compilation);
      const literals = compilation.observed.filter(row => row.kind === "KindNumericLiteral");
      assert.equal(literals.length, 1);
      assert.equal(literals[0].source?.kind === "source-primitive" && literals[0].source.name === "float64", true,
        "raw numeric source stays f64");
      const conversions = compilation.observed.filter(row => row.contextual?.conversion?.id === "native-f64-to-f32");
      assert.equal(conversions.length, 1, "one contextual conversion");
      assert.equal(conversions[0].contextual.sourceCarrier?.name === "float64" &&
        conversions[0].contextual.targetCarrier?.name === "float32", true, "sealed actual value contract");
      assert.equal(compilation.text.includes("_f64 as f32"), true, "existing native conversion consumer emits the cast");
    });
  }

  for (const synthetic of [false, true]) {
    test(`${surface}: ${synthetic ? "checked" : "authored"} wide comparison keeps rejected float32 candidate unused`, () => {
      const compilation = compile("export function compare(pending: float32): boolean { return pending < 1e40; }", surfaces, synthetic);
      assertAccepted(compilation);
      assert.equal(compilation.text.includes("1e+40_f64"), true, "wider selected operation is retained");
      assert.equal(compilation.observed.some(row => row.contextual?.conversion?.id === "native-f64-to-f32"), false,
        "unused narrowing candidate is not admitted");
    });
  }
}
