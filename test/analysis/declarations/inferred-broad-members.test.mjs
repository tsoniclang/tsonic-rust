import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustBroadSourceValueTargetType } from "../../../dist/policy/types/resolution/broad-values.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const surfaces of [[], ["js"]]) {
  test(`inferred broad members retain their authored storage owner on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
type Value = unknown;
export function run(value: Value): void {
  const shorthand = { value };
  const ordinary = { value: value };
  const nested = { child: { value } };
}
` } });
    const broad = rustBroadSourceValueTargetType(surfaces.length !== 0);
    const { ast } = program.source;
    let checked = 0;
    const visit = node => {
      if (ast.is.IsObjectLiteralExpression(node)) {
        const fact = program.facts.getFact(node, rustTargetOperationFactKey);
        assert.equal(fact?.kind, "record-literal");
        const field = fact.fields.find(field => field.sourceName === "value");
        if (field !== undefined) {
          assert.equal(rustTargetTypeRefEquals(field.carrier, broad), true, "authored member keeps its exact closed carrier");
          assert.equal(field.presence, "required");
          assert.equal(field.contractDeclarations.length, 1);
          assert.equal(ast.getSourceFile(field.contractDeclarations[0]) !== undefined, true);
          checked++;
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const sourceFile of program.sourceFiles) visit(sourceFile);
    assert.equal(checked, 3);
  });
}
