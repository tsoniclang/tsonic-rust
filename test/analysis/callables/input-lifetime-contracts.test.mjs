import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableInputLifetimeParameters } from "../../../dist/analysis/facts/source-input-lifetimes.js";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCallableInputTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

test("physical callback lifetimes come only from matching sealed parameter ABI evidence", () => {
  const owner = {};
  const parameter = {};
  const integer = rustSourcePrimitiveTargetType("int64");
  const lifetime = { kind: "parameter", identity: "callback/input", name: "input" };
  const carrier = rustCallableInputTargetType([integer], integer, lifetime);
  const ast = { parameters: declaration => declaration === owner ? [parameter] : [] };
  let selected = { parameterCarrier: carrier, inputLifetime: lifetime };
  const facts = { getFact: (node, key) => node === parameter && key === rustSourceParameterAbiFactKey ? selected : undefined };
  const contract = rustCallableInputLifetimeParameters(owner, ast, facts);
  assert.equal(contract.length, 1);
  assert.equal(contract[0].declaration === parameter, true);
  assert.equal(contract[0].lifetime === lifetime, true);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract[0]), true);
  assert.deepEqual(contract[0].outlives, []);
  for (const mutation of [undefined, { parameterCarrier: carrier },
    { parameterCarrier: integer, inputLifetime: lifetime },
    { parameterCarrier: { ...carrier, referent: integer }, inputLifetime: lifetime },
    { parameterCarrier: carrier, inputLifetime: { ...lifetime, identity: "foreign/input" } }]) {
    selected = mutation;
    assert.equal(rustCallableInputLifetimeParameters(owner, ast, facts).length, 0);
  }
});

test("suspended callable input borrows and static promise payload requirements retain distinct exact owners", () => {
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
  const abi = program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
  const contract = rustCallableInputLifetimeParameters(owner, ast, program.facts);
  assert.equal(contract.length, 1);
  assert.equal(abi.inputLifetime.kind, "parameter");
  assert.equal(abi.parameterCarrier.lifetime.identity, abi.inputLifetime.identity);
  assert.equal(program.sourceLifetimes.contractFor(owner).parameters.length, 1,
    "physical lifetime binders must not change authored generic arity");
  const requirements = program.declarationGenericRequirements.contractFor(owner);
  assert.deepEqual(requirements.typeParameters[0].requirements, ["clone", "static"]);
});
