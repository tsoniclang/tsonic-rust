import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustInvariantTypeMarker } from "../../../dist/backend/planner/types/invariant-marker.js";
import { rustGenericCallableStorageArguments } from "../../../dist/target-model/types/carriers/generic-callable-storage.js";

test("native capture markers preserve exact invariant input and output without a redundant singleton tuple", () => {
  const lifetime = { kind: "named", name: "capture" };
  const borrowed = { kind: "reference", mutable: false, referent: { kind: "unit" }, lifetime };
  const native = { kind: "named", path: "CapturedValue" };
  for (const parameters of [[], [borrowed], [borrowed, native]]) {
    const marker = rustInvariantTypeMarker(parameters);
    assert.equal(marker.kind === "named" && marker.path === "core::marker::PhantomData", true,
      "the marker remains the native zero-sized ownership marker");
    const signature = marker.genericArguments[0].type;
    assert.equal(signature.kind === "function-pointer" && signature.parameters.length === 1, true,
      "the same contravariant input and covariant output preserve invariance");
    const environment = signature.parameters[0];
    assert.equal(environment === signature.result, true, "both variance positions retain the identical selected environment");
    if (parameters.length === 1) assert.equal(environment === borrowed && environment.lifetime === lifetime, true,
      "a single actual capture keeps its exact type and lifetime without a type-complexity-only tuple");
    else assert.equal(environment.kind === "tuple" && environment.elements === parameters, true,
      "zero and multiple actual captures retain the exact native tuple and capture order");
  }
});

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
  return { program, declaration, returned, nodes };
}

test("generic native helper prefixes consume one early selected physical capture environment", () => {
  const { program } = fixture(`
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
  const implementations = new Set();
  for (const definition of program.callableValues.generic.definitions) for (const implementation of definition.implementations) {
    if (implementations.has(implementation)) continue;
    implementations.add(implementation);
    const entry = program.records.callableLeading.get(implementation.declaration)?.genericEntry;
    assert.equal(entry?.implementation === implementation, true, "the early entry belongs to the exact admitted implementation");
    assert.equal(entry.environment === program.callableValues.generic.physical.environmentFor(implementation), true,
      "the entry consumes the canonical physical environment completed before capture publication");
    assert.equal(entry.environment.captures.length, 1, "each helper retains only its own callback input");
    assert.equal(entry.helper, true, "the original captured arrows are actual activation helpers");
    assert.equal(entry.suspended, false, "a generic signature alone does not select a suspended helper");
    assert.equal(entry.statePassing, "shared-reference", "the native synchronous helper borrows its exact state");
    const arguments_ = rustGenericCallableStorageArguments(definition.signature.environmentParameters, entry.environment.parameters);
    assert.equal(arguments_.length === entry.arguments.length && arguments_.every((argument, index) =>
      argument.kind === entry.arguments[index].kind && (argument.kind === "type"
        ? argument.type === entry.arguments[index].type : argument === entry.arguments[index])), true,
    "lifetime, signature and physical arguments keep their original ordering and selected identities");
    assert.equal(program.records.genericImplementation.get(implementation)?.entry === entry, true,
      "late requirements and the helper renderer consume the identical early entry without reselection");
  }
  assert.equal(implementations.size, 2, "both original native helper implementations are exercised");
});

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

test("physical family conversion moves only exact producer and capture argument members", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
    export function choose(left: () => number, right: () => number, select: boolean): Identity {
      return select ? make(left) : make(right);
    }
  `);
  const physical = current.program.callableValues.generic.physical;
  const target = current.returned("choose");
  const ast = current.program.source.ast;
  const calls = current.nodes.filter(node => ast.is.IsCallExpression(node) && ast.arguments(node).length === 1 &&
    ["left", "right"].includes(ast.text(ast.arguments(node)[0])));
  assert.equal(calls.length, 2);
  const variants = new Set();
  const carriers = [];
  for (const call of calls) {
    const selected = current.program.callableValues.nativeStorage.valueFor(call);
    assert.notEqual(selected.kind, "unresolved", selected.reason);
    carriers.push(selected.carrier);
    const conversion = physical.conversionFor(selected.carrier, target.carrier);
    assert.equal(conversion !== undefined, true, ast.text(ast.arguments(call)[0]));
    assert.equal(conversion.kind, "variants");
    assert.equal(conversion.members.length, 1);
    assert.equal(conversion.members[0].source.implementation === conversion.members[0].target.implementation, true);
    assert.equal(Object.isFrozen(conversion) && Object.isFrozen(conversion.members) && Object.isFrozen(conversion.members[0]), true);
    variants.add(conversion.members[0].target.variantName);
    assert.equal(physical.conversionFor(target.carrier, selected.carrier) === undefined, true,
      "a joined carrier cannot discard the other captured input");
  }
  assert.equal(variants.size, 2, "one source closure at different input identities keeps distinct target alternatives");
  assert.equal(physical.conversionFor(carriers[0], carriers[1]) === undefined, true,
    "equal logical signatures do not authorize a different actual capture");
});
