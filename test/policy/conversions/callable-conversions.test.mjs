import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableConversionMatches, selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../../dist/target-model/conversions/contextual.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustAbsenceTargetType, rustCallableTargetType, rustClosureTargetType, rustJsValueTargetType, rustOptionTargetType, rustStringTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "source-primitive", name: "string" };
const optional = rustOptionTargetType(number);
const select = (source, target) => selectRustCallableConversion(source, target, selectRustSourceValueConversion);

test("native closure adapters retain exact inputs, results and invocation failure", () => {
  const integer = { kind: "source-primitive", name: "int64" };
  const source = rustCallableTargetType([integer], number);
  const target = rustClosureTargetType([integer], number, true);
  const selected = select(source, target);
  assert.equal(selected !== undefined, true);
  assert.equal(rustCallableConversionMatches(selected, source, target), true);
  assert.equal(rustCallableConversionMatches({ ...selected, target: { ...target, fallible: false } },
    source, { ...target, fallible: false }), false);
  assert.equal(select(source, rustClosureTargetType([integer], number)) === undefined, true);
  assert.equal(select(source, rustClosureTargetType([], number, true)) === undefined, true);
  assert.equal(select(source, rustClosureTargetType([string], number, true)) === undefined, true);
  assert.equal(select(source, rustClosureTargetType([integer], string, true)) === undefined, true);
  assert.equal(rustCallableConversionMatches({ ...selected, parameters: [{ kind: "discard" }] }, source, target), false);
});

test("owning callable inputs borrow only exact elided shared parameters for invocation", () => {
  const nativeString = rustStringTargetType();
  const reference = { kind: "reference", referent: nativeString, mutable: false };
  const source = rustCallableTargetType([reference], number);
  const target = rustCallableTargetType([nativeString], number);
  const selected = select(source, target);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.parameters[0].kind, "borrow");
  assert.equal(Object.isFrozen(selected.parameters[0]), true);
  assert.equal(rustCallableConversionMatches(selected, source, target), true);
  for (const changed of [
    { ...selected, parameters: [{ kind: "borrow", extra: true }] },
    { ...selected, result: { kind: "borrow" } },
  ]) assert.equal(rustCallableConversionMatches(changed, source, target), false);
  for (const carrier of [
    { ...reference, mutable: true },
    { ...reference, lifetime: { kind: "static" } },
    { ...reference, lifetime: { kind: "placeholder" } },
    { ...reference, referent: number },
  ]) {
    const unsafeSource = rustCallableTargetType([carrier], number);
    assert.equal(select(unsafeSource, target), undefined);
    assert.equal(rustCallableConversionMatches({ ...selected, source: unsafeSource }, unsafeSource, target), false);
  }
  assert.equal(select(rustCallableTargetType([], nativeString), rustCallableTargetType([], reference)), undefined);
});

test("stored void and exact absence callbacks complete only into proven native absence storage", () => {
  for (const result of [rustUnitTargetType(), rustAbsenceTargetType()]) {
    const source = rustCallableTargetType([], result);
    for (const destination of [rustJsValueTargetType(), optional]) {
      const target = rustCallableTargetType([number], destination);
      const conversion = select(source, target);
      assert.ok(conversion);
      assert.equal(conversion.result.kind, "absence");
      assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion), true);
      assert.equal(rustCompilerOwnedContextualConversionMatches(source,
        rustCallableTargetType([string], destination), conversion), false);
    }
  }
});

test("nested callable inputs and results reuse exact recursive signature conversion", () => {
  const nativeString = rustStringTargetType();
  const reference = { kind: "reference", referent: nativeString, mutable: false };
  const owned = rustCallableTargetType([nativeString], number);
  const borrowed = rustCallableTargetType([reference], number);
  for (const [source, target, placement] of [
    [rustCallableTargetType([owned], number), rustCallableTargetType([borrowed], number), "parameter"],
    [rustCallableTargetType([], borrowed), rustCallableTargetType([], owned), "result"],
    [rustCallableTargetType([rustCallableTargetType([], borrowed)], number),
      rustCallableTargetType([rustCallableTargetType([], owned)], number), "parameter"],
  ]) {
    const selected = select(source, target);
    assert.equal(selected !== undefined, true, placement);
    assert.equal(rustCallableConversionMatches(selected, source, target), true, placement);
    const nested = placement === "parameter" ? selected.parameters[0] : selected.result;
    assert.equal(nested.kind, "value");
    assert.equal(nested.conversion.kind, "callable-adapter");
    assert.equal(Object.isFrozen(nested.conversion), true);
    for (const replacement of [null, undefined, { ...nested.conversion, extra: true },
      { ...nested.conversion, source: target }, { ...nested.conversion, result: { kind: "borrow" } }]) {
      const changed = { ...nested, conversion: replacement };
      const mutation = placement === "parameter" ? { ...selected, parameters: [changed] }
        : { ...selected, result: changed };
      assert.equal(rustCallableConversionMatches(mutation, source, target), false);
    }
  }
  for (const unsafeReference of [{ ...reference, mutable: true }, { ...reference, lifetime: { kind: "static" } }]) {
    assert.equal(select(rustCallableTargetType([owned], number),
      rustCallableTargetType([rustCallableTargetType([unsafeReference], number)], number)) === undefined, true);
  }
  assert.equal(select(rustCallableTargetType([], nativeString), rustCallableTargetType([], reference)) === undefined, true);
});

test("native callable conversions retain contravariant parameter and covariant result evidence", () => {
  for (const [source, target] of [
    [rustCallableTargetType([], number), rustCallableTargetType([optional], number)],
    [rustCallableTargetType([optional], number), rustCallableTargetType([number], number)],
    [rustCallableTargetType([], number), rustCallableTargetType([], optional)],
    [rustCallableTargetType([], number), rustCallableTargetType([], rustUnitTargetType())],
  ]) {
    const selected = select(source, target);
    assert.ok(selected);
    assert.equal(rustCallableConversionMatches(selected, source, target), true);
    assert.equal(rustCallableConversionMatches({ ...selected, parameters: [...selected.parameters, { kind: "identity" }] }, source, target), false);
    assert.equal(rustCallableConversionMatches({ ...selected, result: { kind: "absence" } }, source, target), false);
  }
  const source = rustCallableTargetType([optional], number);
  const target = rustCallableTargetType([number], number);
  const selected = select(source, target);
  assert.equal(selected.parameters[0].conversion.kind, "option-some");
  assert.equal(rustCallableConversionMatches({ ...selected, parameters: [{ kind: "identity" }] }, source, target), false);
  assert.equal(rustCallableConversionMatches({ ...selected, parameters: [{ kind: "discard" }] }, source, target), false);
});

test("callable conversion cannot invent required results, arguments or unsafe carrier transitions", () => {
  for (const [source, target] of [
    [rustCallableTargetType([], rustUnitTargetType()), rustCallableTargetType([], number)],
    [rustCallableTargetType([number], rustUnitTargetType()), rustCallableTargetType([string], optional)],
    [rustCallableTargetType([number], rustUnitTargetType()), rustCallableTargetType([], optional)],
    [rustCallableTargetType([number], number), rustCallableTargetType([optional], number)],
    [rustCallableTargetType([], number), rustCallableTargetType([], string)],
  ]) assert.equal(select(source, target), undefined);
});

test("stored conversion facts are immutable and reject malformed or contradictory selections", () => {
  const source = rustCallableTargetType([optional], number);
  const target = rustCallableTargetType([number], number);
  const selected = select(source, target);
  assert.ok(Object.isFrozen(selected));
  assert.ok(Object.isFrozen(selected.parameters));
  assert.ok(Object.isFrozen(selected.parameters[0].conversion));
  for (const changed of [
    { ...selected, extra: true }, { ...selected, kind: "callable-absence-completion" },
    { ...selected, parameters: [undefined] }, { ...selected, parameters: new Array(1) },
    { ...selected, parameters: [{ kind: "unknown" }] },
    { ...selected, parameters: [{ ...selected.parameters[0], extra: true }] },
    { ...selected, result: { kind: "identity", extra: true } },
    { ...selected, parameters: [{ kind: "value", conversion: { kind: "option-some", source: string, element: number } }] },
  ]) assert.equal(rustCallableConversionMatches(changed, source, target), false);
});
