import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { selectRustInferredReturn } from "../../../dist/analysis/callables/inferred-return.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";

for (const [name, source, callsSignature] of [
  ["property and callable scope", `
    function named(value: number): number { return value; }
    export function reveal() { return { call: named, size: 3 }.size; }
  `, true],
  ["numeric operands", `export function reveal(value: number) { return -(value + value); }`, false],
  ["conditional receiver", `export function reveal(flag: boolean, value: number) {
    return flag ? { value }.value : value;
  }`, false],
]) test(`inferred ${name} requests stay in their actual probe transaction`, () => {
  let walk;
  const context = analyzeRustErrorEffects(source, { surfaces: [] }, original => ({ ...original,
    records: { ...original.records, typeOnlyDeclarations: { ...original.records.typeOnlyDeclarations,
      finalize(current, files) { walk = current; return original.records.typeOnlyDeclarations.finalize(current, files); },
    } },
  }));
  assert.equal(walk !== undefined, true);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "reveal");
  assert.equal(declaration !== undefined, true);
  const expected = context.records.sourceCallableReturn.get(declaration)?.returnCarrier;
  assert.equal(expected !== undefined, true);
  const scalar = { kind: "source-primitive", name: "float64" };
  const baseline = expected;
  assert.equal(baseline !== undefined, true);
  const original = context.sourceStorage.nodes.map(node => context.records.runtimeCarrier.get(node));
  let scoped = 0;
  const request = { ...walk, inferredReturns: new Map(), resolvingReturns: new Set(),
    operationOptions: { ...walk.operationOptions, callableSignatureCarrier() {
      throw new Error("inferred return used the parent's callable query");
    } },
    callableSignatureCarrierFor(current, selected) {
      assert.equal(current === request, false, "signature resolution receives the actual child transaction");
      scoped++;
      return walk.callableSignatureCarrierFor(current, selected);
    },
  };
  const selected = selectRustInferredReturn(request, declaration, baseline);
  assert.equal(rustTargetTypeRefEquals(selected, expected), true, "the selected raw native result is unchanged");
  if (callsSignature) {
    const named = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "named");
    assert.equal(named !== undefined, true);
    const probe = createRustCarrierProbe(request);
    assert.equal(rustTargetTypeRefEquals(probe.operationOptions.callableSignatureCarrier(named),
      rustCallableTargetType([scalar], scalar)), true, "the actual checked source signature is resolved in its child");
    assert.equal(scoped > 0, true, "the checked callback is explicitly exercised, not inferred from a cached read");
  }
  assert.equal(context.sourceStorage.nodes.every((node, index) => context.records.runtimeCarrier.get(node) === original[index]), true,
    "the parent retains all exact runtime carrier identities");
  assert.equal(walk.inferredReturns === request.inferredReturns, false);
});
