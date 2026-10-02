import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableConversionMatches, selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../../dist/target-model/conversions/contextual.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustAbsenceTargetType, rustCallableTargetType, rustJsValueTargetType, rustOptionTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "source-primitive", name: "string" };
const optional = rustOptionTargetType(number);
const select = (source, target) => selectRustCallableConversion(source, target, selectRustSourceValueConversion);

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
