import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

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
      const fact = program.records.targetOperation.get(node);
      if (fact?.kind === "builtin-error-property") operations.push({ node, fact });
      for (const child of ast.children(node)) visit(child);
    };
    for (const file of program.sourceFiles) visit(file);
    assert.equal(operations.length, 3);
    for (const { node, fact } of operations) {
      const optional = program.records.optionalChain.get(node);
      assert.equal(optional !== undefined, true, fact.property);
      const context = (records = program.records) => ({ input: { program: { ...program, records } }, diagnostics: [],
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
        createRustRecordFixture({...program.records,
optionalChain: { get: (subject) => subject === node ? undefined : program.records.optionalChain.get(subject) }}),
        createRustRecordFixture({...program.records,
optionalChain: { get: (subject) => subject === node
    ? { ...optional, innerResultCarrier: wrong } : program.records.optionalChain.get(subject) }}),
        createRustRecordFixture({...program.records,
targetOperation: { get: (subject) => subject === node
    ? { ...fact, resultCarrier: wrong } : program.records.targetOperation.get(subject) }}),
        createRustRecordFixture({...program.records,
targetOperation: { get: (subject) => subject === node
    ? { ...fact, receiverCarrier: wrong } : program.records.targetOperation.get(subject) }}),
        createRustRecordFixture({runtimeCarrier: { get: (subject) => subject === node ? { carrier: wrong } : program.records.runtimeCarrier.get(subject) }}),
        createRustRecordFixture({selectedOperation: { get: (subject) => subject === node
    ? { ...program.records.selectedOperation.get(subject), resultType: wrong } : program.records.selectedOperation.get(subject) }}),
      ];
      for (const mutation of mutations) {
        const selected = context({ ...program.records, ...mutation });
        assert.equal(planPropertyAccess(node, selected) === undefined, true, fact.property);
        assert.equal(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"), true, fact.property);
      }
    }
  });
}
