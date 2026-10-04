import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustOptionalChainFactKey, rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planPropertyAccess } from "../../../../dist/backend/planner/expressions/properties.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`optional ${surfaces.length === 0 ? "native" : "JS"} Error observations use exact member stages and one native borrow`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      export function name(error: Error | undefined): string | undefined { return error?.name; }
      export function message(error: Error | undefined): string | undefined { return error?.message; }
      export function stack(error: Error | undefined): string | undefined { return error?.stack; }
    ` } });
    const { ast } = program.source;
    const operations = [];
    const visit = node => {
      const fact = program.facts.getFact(node, rustTargetOperationFactKey);
      if (fact?.kind === "builtin-error-property") operations.push({ node, fact });
      for (const child of ast.children(node)) visit(child);
    };
    for (const file of program.sourceFiles) visit(file);
    assert.equal(operations.length, 3);
    for (const { node, fact } of operations) {
      const optional = program.facts.getFact(node, rustOptionalChainFactKey);
      assert.equal(optional !== undefined, true, fact.property);
      const context = (facts = program.facts) => ({ input: { program: { ...program, facts } }, diagnostics: [],
        sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
        syntheticNames: createRustSyntheticNameState(ast, node, []),
        moduleName: "index", structuralShapesModuleName: "shapes", moduleNameByFileName: new Map(),
        externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
        externalStructuralShapeModuleByFileName: new Map() });
      const valid = context();
      const planned = planPropertyAccess(node, valid);
      assert.equal(planned !== undefined, true, JSON.stringify(valid.diagnostics));
      assert.equal(valid.diagnostics.length, 0);
      const printed = printRustExpr(planned);
      assert.match(printed, new RegExp(`ErrorObject::error_${fact.property}\\(optional_receiver\\)`));
      assert.doesNotMatch(printed, /ErrorObject::error_\w+\(&optional_receiver\)/u);
      const wrong = rustSourcePrimitiveTargetType("int32");
      const mutations = [
        { getFact: (subject, key) => subject === node && key === rustOptionalChainFactKey ? undefined : program.facts.getFact(subject, key) },
        { getFact: (subject, key) => subject === node && key === rustOptionalChainFactKey
          ? { ...optional, innerResultCarrier: wrong } : program.facts.getFact(subject, key) },
        { getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
          ? { ...fact, resultCarrier: wrong } : program.facts.getFact(subject, key) },
        { getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
          ? { ...fact, receiverCarrier: wrong } : program.facts.getFact(subject, key) },
        { getRuntimeCarrierFact: subject => subject === node ? { carrier: wrong } : program.facts.getRuntimeCarrierFact(subject) },
        { getSelectedTargetProperty: subject => subject === node
          ? { ...program.facts.getSelectedTargetProperty(subject), resultType: wrong } : program.facts.getSelectedTargetProperty(subject) },
      ];
      for (const mutation of mutations) {
        const selected = context({ ...program.facts, ...mutation });
        assert.equal(planPropertyAccess(node, selected) === undefined, true, fact.property);
        assert.equal(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"), true, fact.property);
      }
    }
  });
}
