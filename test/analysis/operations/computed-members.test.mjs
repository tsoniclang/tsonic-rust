import assert from "node:assert/strict";
import test from "node:test";
import { nativeNamedMemberSource } from "../../../../tsonic/test/fixtures/native-callback-closure.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustComputedMemberFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`computed native methods seal their exact key evaluation on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": nativeNamedMemberSource } });
    const { ast } = program.source;
    const computed = [];
    const variables = new Map();
    const visit = node => {
      if (ast.is.IsElementAccessExpression(node)) {
        const fact = program.facts.getFact(node, rustComputedMemberFactKey);
        if (fact !== undefined) computed.push({ node, fact });
      }
      if (ast.is.IsVariableDeclaration(node)) variables.set(ast.text(ast.name(node)), node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    const method = computed.find(({ node }) => {
      const call = ast.parent(node);
      const fact = call === undefined ? undefined : program.facts.getFact(call, rustTargetOperationFactKey);
      return fact?.kind === "source-call" && fact.target.form === "method" &&
        ast.is.IsCallExpression(ast.as.AsElementAccessExpression(node)?.ArgumentExpression);
    });
    assert.equal(method !== undefined, true, "selected computed method has a sealed evaluation plan");
    assert.equal(method.fact.evaluateKey, true);
    assert.equal(method.fact.evaluateReceiver, true);
    assert.equal(Object.isFrozen(method.fact), true);
    const syntax = ast.as.AsElementAccessExpression(method.node);
    assert.equal(method.fact.receiver === syntax.Expression, true, "exact original receiver");
    assert.equal(method.fact.key === syntax.ArgumentExpression, true, "exact authored key");
    const staticMethod = computed.find(({ node }) => {
      const call = ast.parent(node);
      const fact = call === undefined ? undefined : program.facts.getFact(call, rustTargetOperationFactKey);
      return fact?.kind === "source-call" &&
        (fact.target.form === "function" || fact.target.form === "static-method");
    });
    assert.equal(staticMethod !== undefined, true, "static calls retain their exact computed-key effects");
    assert.equal(staticMethod.fact.evaluateKey, true);
    assert.equal(staticMethod.fact.evaluateReceiver, false, "the selected direct class reference is erased");
    const point = program.facts.getRuntimeCarrierFact(variables.get("Point"))?.carrier;
    const pair = program.facts.getRuntimeCarrierFact(variables.get("Pair"))?.carrier;
    const nested = rustStructuralObjectCarrierValue(pair)?.fields.find(field => field.sourceName === "point")?.type;
    assert.equal(rustStructuralObjectCarrierValue(point)?.representation, "value");
    assert.equal(rustStructuralObjectCarrierValue(nested)?.representation, "value");
    assert.equal(rustStructuralObjectCarrierValue(nested)?.fields[0]?.type.name, "int32");
    assert.equal(computed.some(({ fact }) => !fact.evaluateKey && ast.is.IsStringLiteral(fact.key)), true,
      "literal selections keep the allocation-free key path");
  });
}
