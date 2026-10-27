import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";



import { rustGenericCallableInvocationBindings } from "../../../dist/analysis/callables/generics/generic-bindings.js";
import { selectRustGenericCallableErrors } from "../../../dist/analysis/callables/generics/generic-errors.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";

function fixture(source) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": source } });
  const { ast } = program.source;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  const invocation = name => {
    const node = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(Node_Expression(ast, node)) === name);
    assert.equal(node !== undefined, true, `selected call ${name}`);
    const fact = program.records.genericCallableInvocation.get(node);
    assert.equal(fact !== undefined, true, `physical invocation ${name}`);
    return { node, fact, definition: program.callableValues.generic.physical.definitionFor(fact.carrier) };
  };
  return { program, invocation };
}

const independent = `
  type Identity = <Value>(value: Value) => Value;
  function first(callback: () => number): Identity {
    return <Value>(value: Value): Value => { callback(); return value; };
  }
  function second(callback: () => string): Identity {
    return <Value>(value: Value): Value => { callback(); return value; };
  }
  export function main(): void {
    const left = first(() => 1);
    const right = second(() => "native");
    left<number>(7); right<string>("exact");
  }
`;

test("generic invocation errors belong to selected physical members, not every logical-family implementation", () => {
  const current = fixture(independent);
  const left = current.invocation("left");
  const right = current.invocation("right");
  for (const selected of [left, right]) {
    assert.equal(selected.definition.members.length, 1);
    assert.equal(selected.fact.invocation.length, 1);
    assert.equal(selected.fact.effects.invocation, "fallible");
    assert.equal(selected.fact.effects.awaiting, "not-applicable");
    assert.equal(selected.fact.awaiting.length, 0);
    assert.equal(rustTargetGenericReferences(selected.fact.invocation[0].errorType).typeIdentities.length, 0);
    const effects = current.program.records.errorEffects.get(selected.node);
    assert.equal(effects.localErrors, false);
    assert.equal(effects.nativeErrors.length, 1);
    assert.equal(effects.nativeErrors[0].identity, selected.fact.invocation[0].identity);
  }
  assert.equal(left.fact.invocation[0].identity !== right.fact.invocation[0].identity, true);
});

test("two exact activations of one generic closure retain both independent error channels", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
    function choose(left: () => number, right: () => number, selected: boolean): Identity {
      return selected ? make(left) : make(right);
    }
    export function main(): void { const call = choose(() => 1, () => 2, true); call<number>(7); }
  `);
  const { definition, fact, node } = current.invocation("call");
  assert.equal(definition.members.length, 2);
  assert.equal(definition.members[0].implementation === definition.members[1].implementation, true);
  assert.equal(fact.invocation.length, 2);
  assert.equal(new Set(fact.invocation.map(source => source.identity)).size, 2);
  assert.equal(current.program.records.errorEffects.get(node).nativeErrors.length, 2);
});

test("physical generic invocation bindings reject foreign definitions and wrong method arity", () => {
  const current = fixture(independent);
  const left = current.invocation("left");
  const right = current.invocation("right");
  const physical = current.program.callableValues.generic.physical;
  const arguments_ = [{ kind: "type", type: { kind: "source-primitive", name: "float64" } }];
  assert.equal(rustGenericCallableInvocationBindings(left.definition, left.fact.carrier, arguments_, physical) !== undefined, true);
  assert.equal(rustGenericCallableInvocationBindings(right.definition, left.fact.carrier, arguments_, physical) === undefined, true);
  assert.equal(rustGenericCallableInvocationBindings(left.definition, left.fact.carrier, [], physical) === undefined, true);
});

test("generic error selection rejects unavailable effects or exact producer errors", () => {
  const { program, invocation } = fixture(independent);
  const { definition } = invocation("left");
  const input = { ast: program.source.ast, sourceLifetimes: program.sourceLifetimes,
    physical: program.callableValues.generic.physical, producers: program.callableValues.nativeProducers,
    effectsFor: declaration => program.records.sourceCallEffects.get(declaration) };
  assert.equal(selectRustGenericCallableErrors(definition, input) !== undefined, true);
  assert.equal(selectRustGenericCallableErrors(definition, { ...input, effectsFor: () => undefined }) === undefined, true);
  assert.equal(selectRustGenericCallableErrors(definition, { ...input,
    producers: { ...input.producers, errorFor: () => undefined } }) === undefined, true);
});

test("sealed generic error correspondence preserves owned member identities without source reselection", () => {
  const { program, invocation } = fixture(independent);
  const { definition } = invocation("left");
  const selected = program.genericCallableErrors.forDefinition(definition);
  assert.equal(selected !== undefined, true, "the selected physical family was analyzed before planning");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.invocation) && Object.isFrozen(selected.awaiting), true);
  assert.equal(selected.invocation.length, 1);
  const member = definition.members[0];
  assert.equal(Object.isFrozen(selected.members.get(member)), true);
  assert.equal(selected.members.get({ ...member }) === undefined, true, "foreign member evidence is rejected");
  assert.equal(program.genericCallableErrors.forDefinition({ ...definition }) === undefined, true, "foreign family evidence is rejected");
  assert.equal(program.genericCallableErrors.forDefinition(definition) === selected, true, "queries reuse the immutable selection");
});
