import assert from "node:assert/strict";
import test from "node:test";
import { suspendedProjectContractsSource } from "../../../../tsonic/test/fixtures/suspended-project-contracts.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustAsyncFunctionFactKey, rustSourceCallableReturnFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCallableInvocationResult } from "../../../dist/analysis/facts/callable-results.js";
import { rustProjectCallableAdaptersKey } from "../../../dist/analysis/facts/project-callable-adapters.js";
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
    assert.equal(selectedParameters.every(parameter => program.facts.getFact(parameter, rustSourceParameterAbiFactKey) !== undefined), true);
    const invocation = rustCallableInvocationResult(program.facts, declaration);
    assert.equal(invocation !== undefined, true, owner + " physical result");
    assert.equal(invocation.id, "rust.js.JsPromise");
    assert.equal(program.facts.getFact(declaration, rustSourceCallableReturnFactKey) !== undefined, true);
  }
  for (const [owner, name, invocation] of [
    ["Writer", "save", "infallible"], ["Completion", "finish", "infallible"],
    ["Failure", "fail", "fallible"], ["ImmediateFailure", "fail", "fallible"],
    ["DeferredFailure", "fail", "infallible"],
  ]) assert.equal(program.facts.getFact(member(owner, name), rustSourceCallEffectsFactKey)?.invocation, invocation, owner);
  for (const [owner, name] of [["AsyncWriter", "save"], ["DeferredFailure", "fail"]]) {
    assert.equal(program.facts.getFact(member(owner, name), rustAsyncFunctionFactKey)?.kind, "js-promise", owner);
  }
  for (const owner of ["AsyncWriter", "DerivedWriter", "EmptyCompletion", "ImmediateFailure", "DeferredFailure"]) {
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === owner);
    const adapters = program.facts.getFact(definition.declaration, rustProjectCallableAdaptersKey);
    assert.equal(adapters !== undefined && adapters.length > 0, true, owner + " adapters");
    assert.equal(Object.isFrozen(adapters), true);
    assert.equal(adapters.every(adapter => rustTargetTypeRefEquals(adapter.implementationReturnCarrier,
      rustCallableInvocationResult(program.facts, adapter.implementation))), true, owner + " invocation ABI");
  }
});
