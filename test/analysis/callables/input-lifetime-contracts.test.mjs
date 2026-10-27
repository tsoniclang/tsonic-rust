import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableInputLifetimeParameters } from "../../../dist/analysis/callables/ownership/source-input-lifetimes.js";

import { rustCallableInputTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

test("physical callback lifetimes come only from matching sealed parameter ABI evidence", () => {
  const owner = {};
  const parameter = {};
  const integer = rustSourcePrimitiveTargetType("int64");
  const lifetime = { kind: "parameter", identity: "callback/input", name: "input" };
  const carrier = rustCallableInputTargetType([integer], integer, lifetime);
  const ast = { parameters: declaration => declaration === owner ? [parameter] : [],
    is: { IsClassDeclaration: () => false, IsClassExpression: () => false } };
  const valid = { form: "required", valueCarrier: carrier, parameterCarrier: carrier, mode: "value", inputLifetime: lifetime };
  let selected = valid;
  const records = createRustRecordFixture({sourceParameterAbi: { get: (node) => node === parameter ? selected : undefined }});
  const contract = rustCallableInputLifetimeParameters(owner, ast, records);
  assert.equal(contract.length, 1);
  assert.equal(contract[0].declaration === parameter, true);
  assert.equal(contract[0].lifetime === lifetime, true);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract[0]), true);
  assert.deepEqual(contract[0].outlives, []);
  const otherParameter = {};
  const sharedAst = { parameters: () => [parameter, otherParameter], is: ast.is };
  const sharedFacts = createRustRecordFixture({sourceParameterAbi: { get: (node) => (node === parameter || node === otherParameter)
    ? selected : undefined }});
  assert.equal(rustCallableInputLifetimeParameters(owner, sharedAst, sharedFacts).length, 1,
    "one shared physical lifetime contributes one native generic binder");
  for (const [label, mutation] of [
    ["missing ABI", undefined],
    ["missing input lifetime", { ...valid, inputLifetime: undefined }],
    ["nonreference physical input", { ...valid, parameterCarrier: integer }],
    ["unrelated physical referent", { ...valid, parameterCarrier: { ...carrier, referent: integer } }],
    ["foreign input lifetime", { ...valid, inputLifetime: { ...lifetime, identity: "foreign/input" } }],
  ]) {
    selected = mutation;
    assert.equal(rustCallableInputLifetimeParameters(owner, ast, records).length, 0, label);
  }
  const nativeValue = rustStringTargetType();
  selected = { form: "required", valueCarrier: nativeValue, mode: "ref", inputLifetime: lifetime,
    parameterCarrier: { kind: "reference", referent: nativeValue, mutable: false, lifetime } };
  const borrowed = rustCallableInputLifetimeParameters(owner, ast, records);
  assert.equal(borrowed.length, 1, "an ordinary native borrowed-return input retains its required header lifetime");
  assert.equal(borrowed[0].declaration === parameter && borrowed[0].lifetime === lifetime, true,
    "native value loans retain their exact source parameter and named lifetime identity");
  selected = { ...selected, mode: "value" };
  assert.equal(rustCallableInputLifetimeParameters(owner, ast, records).length, 0,
    "a mismatched native input mode cannot publish a borrowed header binder");
});

test("owned suspended callable inputs and JS promise payload requirements retain distinct exact owners", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export async function invoke<Value>(callback: () => Promise<Value>): Promise<Value> {
  return await callback();
}
` } });
  const ast = program.source.ast;
  const owners = [];
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "invoke") owners.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
  assert.equal(owners.length, 1);
  const owner = owners[0];
  const parameter = ast.parameters(owner)[0];
  const abi = program.records.sourceParameterAbi.get(parameter);
  const contract = rustCallableInputLifetimeParameters(owner, ast, program.records);
  assert.equal(contract.length, 0);
  assert.equal(abi.inputLifetime === undefined, true, "owning a callback does not borrow its caller's storage");
  assert.equal(abi.parameterCarrier.kind === "reference", false);
  assert.equal(program.sourceLifetimes.contractFor(owner).parameters.length, 1,
    "physical lifetime binders must not change authored generic arity");
  const requirements = program.declarationGenericRequirements.contractFor(owner);
  assert.deepEqual(requirements.typeParameters[0].requirements, ["clone", "static"]);
});
