import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";

function fixture(text) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const source of program.sourceFiles) visit(source);
  const declaration = name => nodes.find(node => ast.is.IsFunctionDeclaration(node) &&
    ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  const returned = name => {
    const selected = program.callableValues.nativeStorage.returnFor(declaration(name));
    assert.notEqual(selected.kind, "unresolved", selected.reason);
    const value = rustGenericCallableValue(selected.carrier);
    assert.equal(value?.physical !== undefined, true, name);
    return { carrier: selected.carrier, value, definition: program.callableValues.generic.physical.definitionFor(selected.carrier) };
  };
  return { program, declaration, returned };
}

test("generic physical factories retain their own input without unrelated family captures", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    export function first(left: () => number): Identity {
      return <Value>(value: Value): Value => { left(); return value; };
    }
    export function second(right: () => number): Identity {
      return <Value>(value: Value): Value => { right(); return value; };
    }
    export function choose(left: () => number, right: () => number, useLeft: boolean): Identity {
      return useLeft ? first(left) : second(right);
    }
  `);
  assert.equal(current.program.callableValues.generic.definitions.length, 1);
  for (const name of ["first", "second"]) {
    const selected = current.returned(name);
    const input = current.program.callableValues.native.inputsFor(current.declaration(name))[0];
    assert.equal(selected.value.physical.members.length, 1, name);
    assert.equal(selected.value.physical.members[0].arguments.length, 1, name);
    assert.equal(selected.value.physical.arguments[selected.value.physical.members[0].arguments[0]].type.identity, input.implementation.identity);
    assert.equal(selected.definition.parameters.length, 1);
    assert.equal(selected.definition.members.length, 1);
    assert.equal(selected.definition === current.program.callableValues.generic.physical.definitionFor(selected.carrier), true);
  }
  const joined = current.returned("choose");
  const inputs = current.program.callableValues.native.inputsFor(current.declaration("choose"));
  assert.equal(joined.value.physical.members.length, 2);
  assert.deepEqual(joined.value.physical.arguments.map(argument => argument.type.identity).sort(),
    inputs.map(input => input.implementation.identity).sort());
  assert.equal(joined.definition.parameters.length, 2);
});

test("one generic source implementation instantiated with two inputs keeps two physical members", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      const original = <Value>(value: Value): Value => { callback(); return value; };
      const alias: Identity = original; return alias;
    }
    export function choose(left: () => number, right: () => number, select: boolean): Identity {
      return select ? make(left) : make(right);
    }
  `);
  const selected = current.returned("choose");
  const members = selected.value.physical.members;
  assert.equal(members.length, 2);
  assert.equal(members[0].origin.declarationIdentity, members[1].origin.declarationIdentity);
  assert.notEqual(selected.value.physical.arguments[members[0].arguments[0]].type.identity,
    selected.value.physical.arguments[members[1].arguments[0]].type.identity);
  assert.equal(selected.definition.members[0].implementation === selected.definition.members[1].implementation, true);
  assert.notEqual(selected.definition.members[0].variantName, selected.definition.members[1].variantName);
});

test("generic physical selection rejects invented members and hidden argument arities", () => {
  const current = fixture(`
    export function make(callback: () => number): <Value>(value: Value) => Value {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
  `);
  const selected = current.returned("make");
  const physical = current.program.callableValues.generic.physical;
  for (const members of [
    selected.value.physical.members.map(member => ({ ...member, origin: { ...member.origin, declarationIdentity: "foreign" } })),
    selected.value.physical.members.map(member => ({ ...member, arguments: [0, 0] })),
  ]) {
    const carrier = rustGenericCallableCarrier({ ...selected.value, physical: { ...selected.value.physical, members } });
    assert.equal(physical.definitionFor(carrier) === undefined, true);
  }
  const { physical: omitted, ...logical } = selected.value;
  assert.equal(physical.definitionFor(rustGenericCallableCarrier(logical)) === undefined, true,
    "a hidden physical environment cannot fall back to a logical carrier");
  assert.equal(physical.environmentFor({ ...selected.definition.members[0].implementation }) === undefined, true,
    "implementation metadata must be the owned object");
});
