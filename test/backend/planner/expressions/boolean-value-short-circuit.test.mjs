import assert from "node:assert/strict";
import test from "node:test";
import { booleanValueShortCircuitSource } from "../../../../../tsonic/test/fixtures/boolean-value-short-circuit.mjs";
import { analyzeRust, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`boolean-controlled native values preserve width and lazy evaluation in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": booleanValueShortCircuitSource } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /if enabled/u);
    assert.match(source, /value: u64/u);
    assert.equal(/9007199254740993_?u64/u.test(source), true, "the exact native u64 literal survives printing");
    assert.doesNotMatch(source, /f64|to_f64|Box::|RefCell|Location::allocate|next\([^)]*\)\.clone/u);
  });
}

test("value short circuit does not admit arbitrary truthiness", () => {
  const { result } = compileRust({ files: { "index.ts": `
    export function rejected(value: number): number { return value && 7; }
  ` } });
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.category === "error"), true);
  assert.equal(result.artifacts.length, 0);
});

test("value short circuit rejects forged branch execution and exact operand conversions", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function conditional(enabled: boolean, value: int32): boolean | int32 { return enabled && value; }
export function skipped(value: int32): boolean { return false && value; }
export function selected(value: int32): int32 { return true && value; }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "logical-value") operations.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(operations.length, 3);
  for (const { node, fact } of operations) {
    const context = selected => ({ input: { program: { ...program,
      facts: { ...program.facts, getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
        ? selected : program.facts.getFact(subject, key) } } }, diagnostics: [],
      sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
      syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
    });
    const accepted = context(fact);
    assert.equal(planBinaryExpression(node, accepted) !== undefined, true, "the unchanged sealed selection plans");
    assert.equal(accepted.diagnostics.length, 0);
    for (const mutation of [
      { branch: fact.branch === "conditional" ? "left" : "conditional", rightConversion: null },
      { branch: "right", leftConversion: null },
      { operator: "or" }, { operationId: "forged" }, { guessed: true },
      { leftCarrier: rustSourcePrimitiveTargetType("int32") },
      { rightCarrier: rustSourcePrimitiveTargetType("uint64") },
      { resultCarrier: rustSourcePrimitiveTargetType("float64") },
      { leftConversion: undefined }, { rightConversion: undefined },
      ...(fact.leftConversion === null ? [{ leftConversion: fact.rightConversion }]
        : [{ leftConversion: { ...fact.leftConversion, sourceCarrier: rustSourcePrimitiveTargetType("int32") } }]),
      ...(fact.rightConversion === null ? [{ rightConversion: fact.leftConversion }]
        : [{ rightConversion: { ...fact.rightConversion, sourceCarrier: rustSourcePrimitiveTargetType("bool") } }]),
    ]) {
      if (Object.keys(mutation).every(key => mutation[key] === fact[key])) continue;
      const rejected = context({ ...fact, ...mutation });
      assert.equal(planBinaryExpression(node, rejected) === undefined, true, `rejects ${fact.branch}: ${Object.keys(mutation).join(",")}`);
      assert.equal(rejected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"), true);
    }
  }
});
