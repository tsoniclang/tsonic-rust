import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { rustAsyncFunctionFactKey, rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCallableInputProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNativeRepresentationMatches } from "../../../dist/target-model/conversions/native-representation.js";
import { rustJsPromiseTargetTypeWithLifetime } from "../../../dist/target-model/types/carriers/js.js";
import { Node_Expression } from "@tsonic/target-api/source";

function fixture(text, surfaces) {
  const context = analyzeRustErrorEffects(text, { surfaces });
  const { ast, facts } = context;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  context.sourceFiles.forEach(visit);
  const declaration = name => {
    const selected = nodes.filter(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
    assert.equal(selected.length, 1, name);
    return selected[0];
  };
  return { context, ast, facts, nodes, declaration };
}

for (const surfaces of [[], ["js"]]) {
  test(`open suspended callback inputs move into their Future while synchronous invocation borrows (${surfaces[0] ?? "native"})`, () => {
    const current = fixture(`
      export async function source<Value>(callback: () => Promise<Value>) { return await callback(); }
      export function retain<Other>(callback: () => Promise<Other>) { return source(callback); }
      export function observed(callback: () => number): number { return callback(); }
      export async function consumer<Actual>(callback: () => Promise<Actual>) { return await retain(callback); }
    `, surfaces);
    for (const name of ["source", "retain", "consumer"]) {
      const owner = current.declaration(name);
      const parameter = current.ast.parameters(owner)[0];
      const abi = current.facts.get(parameter, rustSourceParameterAbiFactKey);
      assert.equal(abi !== undefined, true, name);
      assert.equal(abi.parameterCarrier.kind === "reference", false, `${name} owns its exact callback`);
      assert.equal(abi.inputLifetime === undefined, true, `${name} cannot retain a borrow of a local callback`);
      const inputs = current.context.callableValues.native.inputsFor(owner);
      assert.equal(inputs.length, 1);
      const physical = current.context.callableValues.nativeStorage.parameterFor(parameter, abi.parameterCarrier);
      assert.equal(physical.kind, "selected", physical.reason);
      assert.equal(physical.carrier === inputs[0].implementation, true, "no wrapper, Clone, or reference added to C");
      assert.equal(rustTargetGenericReferences(physical.carrier).lifetimes.length, 0,
        "the physical C parameter does not manufacture a reference lifetime");
    }
    const observation = current.facts.get(current.ast.parameters(current.declaration("observed"))[0], rustSourceParameterAbiFactKey);
    assert.equal(rustCallableInputProtocol(observation.parameterCarrier) !== undefined, true,
      "nonretaining synchronous observations keep the existing native borrow optimization");
    const call = current.nodes.find(node => current.ast.is.IsCallExpression(node) &&
      current.ast.text(Node_Expression(current.ast, node)) === "source");
    const returned = current.facts.get(current.declaration("retain"), rustSourceCallableReturnFactKey).returnCarrier;
    const selected = current.facts.get(call, rustTargetOperationFactKey).resultCarrier;
    assert.equal(rustTargetTypeRefEquals(returned, selected), true, "forwarded storage retains the producer's exact carrier");
  });

  test(`authored borrowed inputs keep their exact region through an owning async callback (${surfaces[0] ?? "native"})`, () => {
    const current = fixture(`
      import type { int32 } from "@tsonic/core/types.js";
      import type { Life, Ref } from "@tsonic/rust/types.js";
      import { load } from "@tsonic/rust/lang.js";
      export async function borrowed<Region extends Life>(value: Ref<int32, Region>, callback: () => int32): Promise<int32> {
        return load(value) + callback();
      }
    `, surfaces);
    const owner = current.declaration("borrowed");
    const [value, callback] = current.ast.parameters(owner).map(parameter =>
      current.facts.get(parameter, rustSourceParameterAbiFactKey));
    assert.equal(value.parameterCarrier.kind, "reference");
    assert.equal(value.parameterCarrier.lifetime.kind, "parameter");
    assert.equal(callback.parameterCarrier.kind === "reference", false);
    const asynchronous = current.facts.get(owner, rustAsyncFunctionFactKey);
    assert.equal(asynchronous !== undefined, true);
    if (surfaces.length !== 0) {
      assert.equal(asynchronous.storage.kind, "lifetime");
      assert.equal(asynchronous.storage.lifetime.identity, value.parameterCarrier.lifetime.identity);
      const shortened = rustJsPromiseTargetTypeWithLifetime(asynchronous.outputCarrier, { kind: "static" });
      assert.equal(rustNativeRepresentationMatches(asynchronous.futureCarrier, shortened), false,
        "owning C never permits an authored external borrow to become static");
    }
  });
}
