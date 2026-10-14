import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

function nodesOf(source, files) {
  const nodes = [];
  const visit = node => { nodes.push(node); source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  files.forEach(visit);
  return nodes;
}

const cases = [
  ["property", "interface Item { value: number; }", "item: Item | undefined", "item?.value", ["property"], ["map"]],
  ["nested property", "interface Item { nested?: { value: number }; }", "item: Item | undefined", "item?.nested?.value",
    ["property", "property"], ["and-then", "map"]],
  ["element", "", "item: number[] | undefined", "item?.[0]", ["indexer"]],
  ["call", "", "item: ((value: number) => number) | undefined", "item?.(1)", ["method"], ["map"]],
  ["method", "interface Item { read(value: number): number; }", "item: Item | undefined", "item?.read(1)", ["method"], ["map"]],
  ["nested call", "interface Item { action?: (value: number) => number; }", "item: Item | undefined", "item?.action?.(1)",
    ["method", "property"], ["and-then", "map"]],
];

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  for (const [name, declarations, parameter, expression, operationKinds, lowerings] of cases) {
    test(`checked ${name} guard retains its exact source, selected native carriers and lowering in ${surface}`, () => {
      const { source, program } = analyzeRust({ surfaces, files: { "index.ts": `
        ${declarations}
        export function run(${parameter}): number | undefined { return ${expression}; }
      ` } });
      const nodes = nodesOf(source, program.sourceFiles);
      const identities = new Set(nodes);
      const selected = nodes.filter(node => program.records.optionalChain.get(node) !== undefined);
      assert.equal(selected.length, operationKinds.length);
      assert.deepEqual(selected.map(node => program.records.optionalChain.get(node).operationKind).sort(), [...operationKinds].sort());
      const expectedLowerings = lowerings ?? [surface === "js" ? "and-then" : "map"];
      assert.deepEqual(selected.map(node => program.records.optionalChain.get(node).lowering).sort(), [...expectedLowerings].sort());
      for (const node of selected) {
        const fact = program.records.optionalChain.get(node);
        assert.equal(fact.expression === node, true);
        assert.equal(identities.has(fact.guard), true, "guard is the exact checked source expression");
        assert.equal(fact.guardDepth, 1);
        assert.equal(rustTargetTypeRefEquals(fact.sourceGuardCarrier, fact.selectedGuardCarrier), false);
        assert.equal(Object.isFrozen(fact), true);
        assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, program.records.runtimeCarrier.get(node)?.carrier), true);
        assert.equal(program.records.runtimeCarrier.get(fact.guard) !== undefined, true);
      }
      assert.deepEqual(Object.keys(program.records.optionalChain), ["get"]);
      assert.equal(program.records.optionalChains === undefined, true);
    });
  }

  test(`module lexical declarations publish exact immutable empty environments in ${surface}`, () => {
    const { source, program } = analyzeRust({ surfaces, files: { "index.ts": `
      function read(value: number): number { return value; }
      export function run(value: number): number { return read(value); }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const functions = nodes.filter(node => source.ast.is.IsFunctionDeclaration(node));
    assert.equal(functions.length, 2);
    for (const node of functions) {
      const fact = program.records.closureCapture.get(node);
      assert.equal(fact !== undefined, true);
      assert.deepEqual(Object.keys(fact).sort(), ["captures", "receiverFields", "receivers"]);
      assert.equal(fact.captures.length + fact.receiverFields.length + fact.receivers.length, 0);
      assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.captures) &&
        Object.isFrozen(fact.receiverFields) && Object.isFrozen(fact.receivers), true);
    }
    assert.deepEqual(Object.keys(program.records.closureCapture), ["get"]);
    assert.equal(program.records.closureCaptures === undefined, true);
  });

  test(`checked lexical class capture retains the exact selected native environment metadata in ${surface}`, () => {
    const { source, program } = analyzeRust({ surfaces, files: { "index.ts": `
      export function run(value: number): number {
        class Value { read(): number { return value; } }
        return new Value().read();
      }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const declaration = nodes.find(node => source.ast.is.IsClassDeclaration(node));
    const captures = program.records.closureCapture.get(declaration);
    assert.equal(captures !== undefined, true);
    assert.equal(captures.captures.length, 1);
    const selected = captures.captures[0];
    assert.equal(source.ast.kindName(selected.declaration), "KindParameter");
    assert.equal(source.ast.text(source.ast.name(selected.declaration)), "value");
    assert.equal(nodes.includes(selected.reference), true);
    assert.equal(selected.storage, "value");
    assert.equal(typeof selected.fieldName, "string");
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(captures), true);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, program.records.runtimeCarrier.get(selected.reference)?.carrier), true);
  });
}

for (const [name, result, expression] of [
  ["map", "number[]", "values.map(value => value + 1)"],
  ["reduce", "number", "values.reduce((sum, value) => sum + value, 0)"],
]) {
  test(`checked ${name} callback publishes its prepared native protocol result without reselecting it`, () => {
    const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
      export function run(values: number[]): ${result} { return ${expression}; }
    ` } });
    const nodes = nodesOf(source, program.sourceFiles);
    const calls = nodes.filter(node => program.records.preparedOperationResult.get(node) !== undefined);
    assert.equal(calls.length, 1);
    const call = calls[0];
    const fact = program.records.preparedOperationResult.get(call);
    const selected = program.records.targetOperation.get(call);
    assert.equal(source.ast.is.IsCallExpression(call), true);
    assert.equal(fact.operationKind, "method");
    assert.equal(fact.operationId, selected.operationId);
    assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, selected.resultCarrier), true);
    assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, program.records.runtimeCarrier.get(call)?.carrier), true);
    assert.deepEqual(Object.keys(fact).sort(), ["operationId", "operationKind", "resultCarrier"]);
    assert.equal(Object.isFrozen(fact), true);
    const closures = nodes.filter(node => source.ast.is.IsArrowFunction(node));
    assert.equal(closures.length, 1);
    const captures = program.records.closureCapture.get(closures[0]);
    assert.equal(captures !== undefined, true);
    assert.equal(captures.captures.length + captures.receivers.length + captures.receiverFields.length, 0);
    assert.equal(Object.isFrozen(captures), true);
    assert.equal(program.records.preparedOperations === undefined, true);
  });
}
