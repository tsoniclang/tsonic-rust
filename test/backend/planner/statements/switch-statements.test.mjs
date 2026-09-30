import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planSwitchStatement } from "../../../../dist/backend/planner/statements/switch-statements.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("switch rejects missing or forged case equality and absence evidence", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function choose(value: string | undefined, candidate: string | undefined): number {
  switch (value) { case "fixed": return 1; case candidate: return 2; case undefined: return 3; default: return 0; }
}` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "switch") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.clauses) && fact.clauses.every(Object.isFrozen));
  const context = selected => ({ input: { program: { ...program, facts: { ...program.facts,
    getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey ? selected : program.facts.getFact(subject, key),
  } } }, diagnostics: [], sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []), controlFlow: { nextLoopId: 0 },
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(fact);
  assert.ok(planSwitchStatement(node, valid), JSON.stringify(valid.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.deepEqual(valid.diagnostics, []);
  const first = fact.clauses[0];
  for (const mutation of [
    { clauses: undefined }, { clauses: [] }, { clauses: new Array(fact.clauses.length) },
    { clauses: [null, ...fact.clauses.slice(1)] }, { operationId: "changed" },
    { discriminantCarrier: rustSourcePrimitiveTargetType("int32") },
    ...[
      { comparison: undefined }, { comparison: { kind: "constant", value: true } },
      { comparison: { ...first.comparison, leftOptional: false } },
      { comparison: { ...first.comparison, operation: { ...first.comparison.operation, rustOperator: "!=" } } },
      { carrier: rustSourcePrimitiveTargetType("int32") }, { expression: fact.clauses[1].expression },
    ].map(change => ({ clauses: [{ ...first, ...change }, ...fact.clauses.slice(1)] })),
    { clauses: [...fact.clauses.slice(0, -1), { ...fact.clauses.at(-1), comparison: first.comparison }] },
  ]) {
    const selected = context({ ...fact, ...mutation });
    assert.equal(planSwitchStatement(node, selected), undefined);
    assert.ok(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
  }
});
