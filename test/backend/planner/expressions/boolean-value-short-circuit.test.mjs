import assert from "node:assert/strict";
import test from "node:test";
import { booleanValueShortCircuitSource } from "../../../../../tsonic/test/fixtures/boolean-value-short-circuit.mjs";
import { analyzeRust, artifactText, compileRust } from "../../../helpers/rust-session.mjs";


import { BinaryExpression_Left } from "@tsonic/target-api/source";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { analyzeRustBinaryEmission } from "../../../../dist/analysis/operations/binary-emission.js";
import { createRustBinaryEmissionProducer } from "../../../../dist/analysis/program/records/expression-binary.js";
import { admitRustConversionEmission } from "../../../../dist/analysis/conversions/emission.js";
import { createRustConversionEmissionProducer } from "../../../../dist/analysis/program/records/conversion-emission.js";
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
export function projected(value: boolean | undefined, other: int32): boolean | int32 {
  if (value !== undefined) return value && other;
  return false;
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "logical-value") operations.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(operations.length, 4);
  for (const { node, fact } of operations) {
    const left = BinaryExpression_Left(ast, node);
    // The binary emission owner seals only an exact logical-value selection; the planner renders the sealed plan.
    const seal = records => {
      const producer = createRustBinaryEmissionProducer(() => undefined);
      const issues = analyzeRustBinaryEmission({ ...program, records: { ...program.records, ...records } }, [node], producer);
      return { issues, emission: producer.records.binaryEmission.get(node) };
    };
    const forged = selected => ({ targetOperation: { get: subject => subject === node ? selected : program.records.targetOperation.get(subject) } });
    const refused = (sealed, label) => {
      assert.equal(sealed.emission, undefined, label);
      assert.equal(sealed.issues.some(issue => issue.code === "RUST_MISSING_TARGET_FACT" &&
        issue.evidence.includes("target.capability=rust.backend.logical-value-evidence")), true, label);
    };
    const accepted = seal({});
    assert.equal(accepted.issues.length, 0);
    assert.equal(accepted.emission?.fact, fact, "the unchanged selection is sealed");
    // Each branch conversion's physical contract is sealed by the conversion emission owner.
    const conversions = createRustConversionEmissionProducer(() => undefined);
    const admit = conversion => {
      if (conversion?.kind === "semantic") admitRustConversionEmission(conversions, conversion.conversion, program.typeDefinitions);
      else if (conversion?.kind === "sequence") conversion.steps.forEach(admit);
    };
    admit(fact.leftConversion);
    admit(fact.rightConversion);
    const sealed = { ...program, records: { ...program.records,
      binaryEmission: { get: subject => subject === node ? accepted.emission : program.records.binaryEmission.get(subject) },
      conversionContract: { get: conversion => conversions.records.conversionContract.get(conversion) ?? program.records.conversionContract.get(conversion) } } };
    const context = { input: { program: sealed }, diagnostics: [],
      sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
      syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
    };
    assert.equal(planBinaryExpression(node, context) !== undefined, true, "the sealed selection plans");
    assert.equal(context.diagnostics.length, 0);
    if (program.records.flowReadProjection.get(left) !== undefined) {
      refused(seal({ flowReadProjection: { get: subject => subject === left ? undefined : program.records.flowReadProjection.get(subject) } }),
        "a physical Option cannot substitute for its selected bool");
    }
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
      refused(seal(forged({ ...fact, ...mutation })), `rejects ${fact.branch}: ${Object.keys(mutation).join(",")}`);
    }
  }
});
