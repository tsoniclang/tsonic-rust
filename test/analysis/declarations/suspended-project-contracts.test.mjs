import assert from "node:assert/strict";
import test from "node:test";
import { suspendedProjectContractsSource } from "../../../../tsonic/test/fixtures/suspended-project-contracts.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";



import { rustCallableInvocationResult } from "../../../dist/policy/types/callables/return-contexts.js";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("suspended interface results consume sealed parameters and preserve exact physical effects", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": suspendedProjectContractsSource } });
  const { ast } = program.source;
  const member = (owner, name) => {
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === owner);
    assert.equal(definition !== undefined, true, owner);
    const declaration = ast.members(definition.declaration).find(candidate => ast.text(ast.name(candidate)) === name);
    assert.equal(declaration !== undefined, true, owner + "." + name);
    return declaration;
  };
  for (const [owner, name, parameters] of [["Writer", "save", 1], ["Completion", "finish", 1], ["Failure", "fail", 0]]) {
    const declaration = member(owner, name);
    const selectedParameters = ast.parameters(declaration);
    assert.equal(selectedParameters.length, parameters);
    assert.equal(selectedParameters.every(parameter => program.records.sourceParameterAbi.get(parameter) !== undefined), true);
    const invocation = rustCallableInvocationResult(program.records, declaration);
    assert.equal(invocation !== undefined, true, owner + " physical result");
    assert.equal(invocation.id, "rust.js.JsPromise");
    assert.equal(program.records.sourceCallableReturn.get(declaration) !== undefined, true);
  }
  for (const [owner, name, invocation] of [
    ["Writer", "save", "infallible"], ["Completion", "finish", "infallible"],
    ["Failure", "fail", "fallible"], ["ImmediateFailure", "fail", "fallible"],
    ["DeferredFailure", "fail", "infallible"],
  ]) assert.equal(program.records.sourceCallEffects.get(member(owner, name))?.invocation, invocation, owner);
  for (const [owner, name] of [["AsyncWriter", "save"], ["DeferredFailure", "fail"]]) {
    assert.equal(program.records.asyncFunction.get(member(owner, name))?.kind, "js-promise", owner);
  }
  for (const owner of ["AsyncWriter", "DerivedWriter", "EmptyCompletion", "ImmediateFailure", "DeferredFailure"]) {
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === owner);
    const adapters = program.records.projectCallableAdapters.get(definition.declaration);
    assert.equal(adapters !== undefined && adapters.length > 0, true, owner + " adapters");
    assert.equal(Object.isFrozen(adapters), true);
    assert.equal(adapters.every(adapter => rustTargetTypeRefEquals(adapter.implementationReturnCarrier,
      rustCallableInvocationResult(program.records, adapter.implementation))), true, owner + " invocation ABI");
  }
});
