import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture(text) {
  const program = analyzeRustErrorEffects(text, { surfaces: [] });
  const source = program.source;
  const storage = program.sourceStorage;
  const native = program.callableValues.native;
  const plan = program.callableValues.selected.nativeCaptures;
  const closures = storage.nodes.filter(node => source.ast.is.IsArrowFunction(node));
  const declaration = name => storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  return { program, native, storage, plan, closures, declaration };
}

test("native captured equal-signature inputs retain distinct physical types without rewriting logical facts", () => {
  const current = fixture(`
    export function make(left: () => number, right: () => number): <Value>(value: Value) => Value {
      return <Value>(value: Value): Value => { left(); right(); return value; };
    }
  `);
  const closure = current.closures[0];
  const logical = current.program.records.closureCapture.get(closure);
  const selected = current.plan.forDeclaration(closure);
  assert.equal(selected.kind, "resolved", selected.reason);
  const inputs = current.native.inputsFor(current.declaration("make"));
  assert.equal(selected.inputs.length, 2);
  assert.equal(selected.captures.length, 2);
  assert.equal(inputs[0].implementation.identity !== inputs[1].implementation.identity, true);
  for (const input of inputs) {
    assert.equal(selected.inputs.includes(input), true);
    assert.equal(selected.captures.includes(input.implementation), true);
    assert.equal(selected.environment.typeIdentities.includes(input.implementation.identity), true);
    assert.equal(logical.captures.some(capture => capture.carrier === input.implementation), false);
  }
  assert.equal(current.program.records.closureCapture.get(closure) === logical, true);
  assert.equal(current.plan.forDeclaration(closure) === selected, true);
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.captures) && Object.isFrozen(selected.inputs), true);
});

test("native capture environment keeps ordinary captured values and excludes method generic parameters", () => {
  const current = fixture(`
    export function make<Outer>(captured: Outer): <Value>(value: Value) => Outer {
      return <Value>(value: Value): Outer => captured;
    }
  `);
  const closure = current.closures[0];
  const selected = current.plan.forDeclaration(closure);
  assert.equal(selected.kind, "resolved", selected.reason);
  assert.equal(selected.inputs.length, 0);
  assert.equal(selected.environment.typeParameters.length, 1);
  const logical = current.program.records.closureCapture.get(closure);
  assert.equal(rustTargetTypeRefEquals(selected.captures[0], logical.captures[0].carrier), true);
});

test("native capture environment rejects ambiguous mutation instead of choosing the first input", () => {
  const source = `
    export function make(left: () => number, right: () => number): <Value>(value: Value) => Value {
      left = right;
      return <Value>(value: Value): Value => { left(); return value; };
    }
  `;
  const current = fixture(source);
  const selected = current.plan.forDeclaration(current.closures[0]);
  assert.equal(selected.kind, "unresolved");
  assert.match(selected.reason, /physical|distinct|alternative/u);
  const { result } = compileRust({ files: { "index.ts": source } });
  assert.equal(result.artifacts.length, 0, "ambiguous mutation never publishes native output");
  assert.equal(result.diagnostics.length > 0, true, "the complete physical ABI also rejects the unresolved capture");
});

test("native capture environments retain exact receiver fields and whole receiver owners", () => {
  const current = fixture(`
    export class Counter {
      readonly count = 2;
      read(): number { return this.count; }
      field(): <Value>(value: Value) => number { return <Value>(value: Value): number => this.count; }
      owner(): <Value>(value: Value) => number { return <Value>(value: Value): number => this.read(); }
    }
  `);
  let fields = 0;
  let receivers = 0;
  for (const closure of current.closures) {
    const logical = current.program.records.closureCapture.get(closure);
    const selected = current.plan.forDeclaration(closure);
    assert.equal(selected.kind, "resolved", selected.reason);
    fields += selected.receiverFields.length;
    receivers += selected.receivers.length;
    for (const [index, carrier] of selected.receiverFields.entries())
      assert.equal(rustTargetTypeRefEquals(carrier, logical.receiverFields[index].carrier), true);
    for (const [index, carrier] of selected.receivers.entries())
      assert.equal(rustTargetTypeRefEquals(carrier, logical.receivers[index].carrier), true);
  }
  assert.equal(fields, 1);
  assert.equal(receivers, 1);
});

test("native capture query rejects foreign declarations without inspecting custom getters", () => {
  const current = fixture(`export function make(): <Value>(value: Value) => Value { return <Value>(value: Value): Value => value; }`);
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw Error("not owned"); } });
  assert.equal(current.plan.forDeclaration(foreign).kind, "unresolved");
  assert.equal(inspected, 0);
  assert.equal(current.plan.forDeclaration(current.declaration("make")).kind, "unresolved",
    "only declarations with finalized capture facts are accepted");
});
