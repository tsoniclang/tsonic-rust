import assert from "node:assert/strict";
import test from "node:test";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustContextualRuntimeConversionContract } from "../../../dist/policy/conversions/contextual.js";

function checked(text, surfaces) {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": text } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
  const declaration = name => {
    const selected = nodes.find(node => ast.is.IsFunctionDeclaration(node) &&
      ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
    assert.equal(selected !== undefined, true, `${name}: original checked declaration exists`);
    return selected;
  };
  return { program, ast, nodes, declaration };
}

function inputRequirements(current, declaration) {
  const inputs = current.program.callableValues.native.inputsFor(declaration);
  assert.equal(inputs.length, 1, "exactly the authored callable input has a native implementation parameter");
  const input = inputs[0];
  assert.equal(input.subject.node === current.ast.parameters(declaration)[0], true,
    "the native implementation retains the original value-parameter node");
  const header = current.program.records.nativeGenerics.get(declaration);
  assert.equal(header !== undefined, true, "the original declaration has its completed native generic header");
  const contracts = [
    current.program.declarationGenericRequirements.contractFor(declaration),
    current.program.declarationGenericRequirements.contractFor(declaration, true),
    header.sourceRequirements,
    header.bodyRequirements,
  ];
  return { input, requirements: contracts.map((contract, index) => {
    assert.equal(contract !== undefined, true, `${index}: source/body/header contract is published`);
    const parameter = contract.nativeInputs.find(candidate => candidate.identity === input.implementation.identity);
    assert.equal(parameter !== undefined, true, `${index}: the exact native implementation identity is retained`);
    return parameter.requirements;
  }) };
}

const forwarded = [
  ["transitive", "function send<Value>(done: (value: Value) => void, value: Value): void { done(value); } function forward<Value>(done: (value: Value) => void, value: Value): void { send(done, value); }", "forward(done, value)"],
  ["recursive", "function send<Value>(done: (value: Value) => void, value: Value, depth: number): void { if (depth > 0) send(done, value, depth - 1); else done(value); }", "send(done, value, 1)"],
];

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  for (const [name, helpers, invocation] of forwarded) {
    test(`native input Clone follows the original ${name} body read in ${surface}`, () => {
      const current = checked(`${helpers}
export function make<Value>(done: (value: Value) => void, value: Value): () => void {
  return () => { ${invocation}; };
}`, surfaces);
      const make = current.declaration("make");
      const { input, requirements } = inputRequirements(current, make);
      for (const [index, required] of requirements.entries()) {
        assert.equal(required.includes("clone"), true, `${index}: body cloning requires Clone on the native implementation`);
      }
      const arrow = current.nodes.find(node => current.ast.is.IsArrowFunction(node) &&
        sourceEnclosingCallable(current.ast.parent(node), current.ast) === make);
      assert.equal(arrow !== undefined, true, "the original returned closure is present");
      const nested = current.program.declarationGenericRequirements.contractFor(arrow);
      assert.equal(nested !== undefined && nested.nativeInputs.some(parameter =>
        parameter.identity === input.implementation.identity && parameter.requirements.includes("clone")), true,
      "the nested body's native obligation propagates through the existing callable contract");
      const capture = current.program.records.captureOwnership.get(arrow)?.find(row => row.declaration === input.subject.node);
      assert.equal(capture !== undefined && capture.read.kind === "move" && capture.invocation.kind === "move", true,
        "capturing the input still moves it; only the actual repeated body read requires Clone");
      const argument = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "done" &&
        current.ast.is.IsCallExpression(current.ast.parent(node)) && sourceEnclosingCallable(node, current.ast) === arrow &&
        current.ast.arguments(current.ast.parent(node)).includes(node));
      assert.equal(argument !== undefined, true, "the source-call argument is the original body node");
      const physical = current.program.callableValues.nativeStorage.operandFor(argument);
      assert.equal(physical.kind === "selected" && physical.carrier.kind === "type-parameter" &&
        physical.carrier.identity === input.implementation.identity, true,
      "the clone obligation names the selected stored native implementation, not its logical Callable type");
      const read = current.program.ownership.reads.get(argument);
      assert.equal(read?.source.kind === "clone" && read.value.kind === "clone", true,
        "the actual body read is a clone independently of construction ownership");
    });
  }

  test(`a source-call borrow conversion adds no native input Clone bound in ${surface}`, () => {
    const current = checked(`function send<Value>(done: (value: Value) => void, value: Value): void { done(value); }
export function make<Value>(done: (value: Value) => void, value: Value): () => void {
  return () => { send(done, value); };
}`, surfaces);
    const make = current.declaration("make");
    const { input, requirements } = inputRequirements(current, make);
    for (const [index, required] of requirements.entries()) {
      assert.equal(required.includes("clone"), false, `${index}: the selected borrowed conversion does not clone its native input`);
    }
    const arrow = current.nodes.find(node => current.ast.is.IsArrowFunction(node) &&
      sourceEnclosingCallable(current.ast.parent(node), current.ast) === make);
    assert.equal(arrow !== undefined, true, "the identical original returned closure is present");
    const nested = current.program.declarationGenericRequirements.contractFor(arrow);
    assert.equal(nested !== undefined && nested.nativeInputs.some(parameter =>
      parameter.identity === input.implementation.identity && !parameter.requirements.includes("clone")), true,
    "the nested and enclosing contracts retain the same native identity without a gratuitous Clone bound");
    const capture = current.program.records.captureOwnership.get(arrow)?.find(row => row.declaration === input.subject.node);
    assert.equal(capture !== undefined && capture.read.kind === "move" && capture.invocation.kind === "move", true,
      "construction and invocation capture ownership remain moves");
    const argument = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "done" &&
      current.ast.is.IsCallExpression(current.ast.parent(node)) && sourceEnclosingCallable(node, current.ast) === arrow &&
      current.ast.arguments(current.ast.parent(node)).includes(node));
    assert.equal(argument !== undefined, true, "the original source-call argument is retained");
    const conversion = current.program.records.contextualValueConversion.get(argument)?.conversion;
    assert.equal(conversion?.kind, "callable-input", "the admitted conversion is the actual native callable input view");
    assert.equal(rustContextualRuntimeConversionContract(conversion, current.program.typeDefinitions)?.sourceMode, "ref",
      "the canonical conversion contract borrows its original source");
    const read = current.program.ownership.reads.get(argument);
    assert.equal(read?.source.kind === "borrow" && read.value.kind === "clone", true,
      "the source borrow is distinct from ownership of the converted logical value");
  });

  test(`borrowed invocation does not impose Clone on its native implementation in ${surface}`, () => {
    const current = checked("export function invoke<Value>(done: (value: Value) => void, value: Value): void { done(value); }", surfaces);
    const declaration = current.declaration("invoke");
    const { input, requirements } = inputRequirements(current, declaration);
    const physical = current.program.callableValues.nativeStorage.parameterFor(input.subject.node);
    assert.equal(physical.kind === "selected" && physical.carrier.kind === "reference" &&
      physical.carrier.mutable === false && physical.carrier.referent === input.implementation, true,
    "the real native input is an immutable reference to the original implementation");
    for (const [index, required] of requirements.entries()) {
      assert.equal(required.includes("clone"), false, `${index}: a non-Clone native implementation remains admissible`);
    }
  });

  test(`an owned native input can be returned by move without a Clone bound in ${surface}`, () => {
    const current = checked("export function transfer<Value>(done: (value: Value) => void): (value: Value) => void { return done; }", surfaces);
    const declaration = current.declaration("transfer");
    const { requirements } = inputRequirements(current, declaration);
    for (const [index, required] of requirements.entries()) {
      assert.equal(required.includes("clone"), false, `${index}: moving the input never adds a Clone obligation`);
    }
    const returned = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "done" &&
      current.ast.is.IsReturnStatement(current.ast.parent(node)));
    assert.equal(returned !== undefined && current.program.ownership.reads.get(returned)?.value.kind === "move", true,
      "the original return reads the actual input by move");
  });

  test(`Copy source-call arguments retain no clone obligation in ${surface}`, () => {
    const current = checked(`import type { int32 } from "@tsonic/core/types.js";
function send(value: int32): int32 { return value; }
export function twice(value: int32): int32 { send(value); return value; }`, surfaces);
    const declaration = current.declaration("twice");
    const contract = current.program.declarationGenericRequirements.contractFor(declaration);
    assert.equal(contract !== undefined && contract.nativeInputs.length === 0, true,
      "a concrete Copy value introduces no native implementation parameter");
    const argument = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "value" &&
      current.ast.is.IsCallExpression(current.ast.parent(node)) && sourceEnclosingCallable(node, current.ast) === declaration);
    assert.equal(argument !== undefined, true, "the original Copy argument is present");
    assert.equal(contract.uses.some(use => use.node === argument && use.requirements.includes("clone")), false,
      "the native Copy argument does not publish a clone requirement");
    assert.equal(current.program.ownership.reads.get(argument)?.value.kind, "copy", "the native read remains Copy");
  });
}
