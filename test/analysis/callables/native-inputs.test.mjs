import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { Node_Initializer } from "@tsonic/target-api/source";
import { nullishNeverSource } from "../../../../tsonic/test/fixtures/nullish-never.mjs";

function analyze(text) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const ast = program.source.ast;
  const declarations = new Map();
  const visit = node => {
    const name = ast.name(node);
    if (name !== undefined) declarations.set(ast.text(name), node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return { program, ast, declarations, native: program.callableValues.native };
}

test("native callable inputs preserve two equal-signature formals and alias correspondence", () => {
  const { program, ast, declarations, native } = analyze(`
    export function choose(left: () => number, right: () => number): () => number {
      const first = left; const second = right; return first;
    }
  `);
  const owner = declarations.get("choose");
  const inputs = native.inputsFor(owner);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].implementation.identity === inputs[1].implementation.identity, false);
  assert.equal(native.inputsFor(owner) === inputs, true, "sealed query reuses its immutable result");
  for (const [index, name] of ["first", "second"].entries()) {
    const selected = native.originsForValue(Node_Initializer(ast, declarations.get(name)));
    assert.equal(selected.kind === "resolved", true);
    assert.equal(selected.inputs.length, 1);
    assert.equal(selected.inputs[0] === inputs[index], true, name);
    assert.equal(selected.implementations.length, 0);
  }
  for (const [index, parameter] of ast.parameters(owner).entries()) {
    const abi = program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
    const physical = program.callableValues.nativeStorage.parameterFor(parameter, abi.parameterCarrier);
    assert.equal(physical.kind, "selected");
    const carrier = physical.carrier;
    assert.equal(carrier === inputs[index].implementation || carrier?.referent === inputs[index].implementation, true,
      "native representation uses the exact input implementation rather than signature identity");
  }
});

test("native callable inputs retain both parameter mutation alternatives without guessing one implementation", () => {
  const { ast, declarations, native } = analyze(`
    export function choose(left: () => number, right: () => number): () => number {
      left = right; const selected = left; return selected;
    }
  `);
  const inputs = native.inputsFor(declarations.get("choose"));
  const selected = native.originsForValue(Node_Initializer(ast, declarations.get("selected")));
  assert.equal(selected.kind === "resolved", true);
  assert.equal(selected.inputs.length, 2);
  assert.equal(inputs.every(input => selected.inputs.includes(input)), true);
  assert.equal(selected.implementations.length, 0);
});

test("optional narrowing preserves native callable input identity and excludes a never-producing alternative", () => {
  const { native, declarations } = analyze(nullishNeverSource);
  for (const name of ["invoke", "required"]) {
    const declaration = declarations.get(name);
    const inputs = native.inputsFor(declaration);
    assert.equal(inputs.length, 1, name);
    const calls = native.calls.filter(call => call.input.owner === declaration);
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].input === inputs[0], true, "narrowing retains the exact original formal");
    assert.equal(native.callFor(calls[0].node) === calls[0], true, "the invocation is a sealed native protocol call");
  }
});
