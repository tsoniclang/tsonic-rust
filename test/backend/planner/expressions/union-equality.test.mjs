import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey, rustContextualValueConversionFactKey, rustOptionProjectionFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustEffectiveValueCarrier } from "../../../../dist/analysis/facts/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";

function planningContext(program, node, selected) {
  const { ast } = program.source;
  return { input: { program: { ...program,
    facts: { ...program.facts, getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
      ? selected : program.facts.getFact(subject, key) } } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
}

test("union equality rejects stale carriers, paths, operations, coverage and polarity", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Token { value: number = 1; }
export function same(value: string | Token): boolean { return value === "a"; }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "union-equality") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.arms) && fact.arms.every(Object.isFrozen));
  const context = selected => planningContext(program, node, selected);
  const valid = context(fact);
  assert.ok(planBinaryExpression(node, valid), JSON.stringify(valid.diagnostics));
  assert.deepEqual(valid.diagnostics, []);
  const arm = fact.arms[0];
  const mutations = [
    { arms: undefined }, { arms: [] }, { arms: [arm, arm] }, { arms: new Array(1) },
    { arms: [{ ...arm, left: { ...arm.left, path: [] } }] },
    { arms: [{ ...arm, operation: { ...arm.operation, rustOperator: "!=" } }] },
    { arms: [{ ...arm, right: { ...arm.right, carrier: rustSourcePrimitiveTargetType("int64") } }] },
    { exhaustive: true }, { negated: true }, { negated: "false" },
    { leftCarrier: undefined }, { rightCarrier: rustSourcePrimitiveTargetType("int64") },
    { resultCarrier: rustSourcePrimitiveTargetType("int64") }, { operationId: "changed" },
  ];
  for (const mutation of mutations) {
    const selected = context({ ...fact, ...mutation });
    assert.equal(planBinaryExpression(node, selected), undefined, JSON.stringify(mutation));
    assert.ok(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
  }
});

test("nullable union producer does not speculate payload conversions and planner borrows native arms once", () => {
  for (const surfaces of [[], ["js"]]) {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Entry { value: number = 3; }
type Value = string | Entry;
type OptionalValue = Value | null | undefined;
export function equalText(left: OptionalValue, right: string | null | undefined): boolean { return left === right; }
export function equalEntry(left: OptionalValue, right: Entry | null | undefined): boolean { return left === right; }
export function reversed(right: Entry, left: OptionalValue): boolean { return right === left; }
` } });
    const { ast } = program.source;
    const operations = [];
    const visit = node => {
      const fact = program.facts.getFact(node, rustTargetOperationFactKey);
      if (fact?.kind === "union-equality") operations.push({ node, fact });
      for (const child of ast.children(node)) visit(child);
    };
    for (const sourceFile of program.sourceFiles) visit(sourceFile);
    assert.equal(operations.length, 3);
    for (const { node, fact } of operations) {
      const binary = ast.as.AsBinaryExpression(node);
      for (const [operand, selected] of [[binary.Left, fact.leftCarrier], [binary.Right, fact.rightCarrier]]) {
        assert.ok(rustTargetTypeRefEquals(program.facts.getRuntimeCarrierFact(operand)?.carrier, selected));
        assert.ok(rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.facts, operand), selected));
        assert.equal(program.facts.getFact(operand, rustContextualValueConversionFactKey), undefined);
        assert.equal(program.facts.getFact(operand, rustOptionProjectionFactKey), undefined);
      }
      const nativeContext = planningContext(program, node, fact);
      const native = planBinaryExpression(node, nativeContext);
      assert.ok(native, JSON.stringify(nativeContext.diagnostics));
      assert.deepEqual(nativeContext.diagnostics, []);
      assert.doesNotMatch(printRustExpr(native), /\.clone\(|Box::|Arc::|Rc::|dyn |from_closed|\.map\(/u);
      const context = planningContext(program, node, fact);
      context.expressionOverrides = new Map([
        [binary.Left, { expression: { kind: "call", path: "produceLeft", args: [] }, carrier: fact.leftCarrier }],
        [binary.Right, { expression: { kind: "call", path: "produceRight", args: [] }, carrier: fact.rightCarrier }],
      ]);
      const planned = planBinaryExpression(node, context);
      assert.ok(planned, JSON.stringify(context.diagnostics));
      assert.deepEqual(context.diagnostics, []);
      const output = printRustExpr(planned);
      assert.equal(output.match(/produceLeft\(\)/gu)?.length, 1);
      assert.equal(output.match(/produceRight\(\)/gu)?.length, 1);
      assert.ok(output.indexOf("produceLeft()") < output.indexOf("produceRight()"));
      assert.match(output, /Some\([^)]*::Variant\d\(/u);
      assert.doesNotMatch(output, /\.clone\(|Box::|Arc::|Rc::|dyn |from_closed|\.map\(/u);
      if (fact.arms.some(arm => arm.left.path.length === 0 && arm.right.path.length === 0)) assert.match(output, /\(None, None\) => true/u);
      const removed = planningContext(program, node, { ...fact, arms: fact.arms.slice(0, -1) });
      assert.equal(planBinaryExpression(node, removed), undefined);
      assert.ok(removed.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
    }
  }
});
