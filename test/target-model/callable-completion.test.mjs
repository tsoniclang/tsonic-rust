import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableAbsenceCompletionMatches } from "../../dist/target-model/conversions/callable-completion.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../dist/target-model/conversions/contextual.js";
import { rustAbsenceTargetType, rustCallableTargetType, rustJsValueTargetType, rustOptionTargetType, rustUnitTargetType } from "../../dist/target-model/types/index.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "source-primitive", name: "string" };

test("stored void and exact absence callbacks complete only into proven native absence storage", () => {
  for (const result of [rustUnitTargetType(), rustAbsenceTargetType()]) {
    const source = rustCallableTargetType([], result);
    for (const destination of [rustJsValueTargetType(), rustOptionTargetType(number)]) {
      const target = rustCallableTargetType([number], destination);
      assert.equal(rustCallableAbsenceCompletionMatches(source, target), true);
      const conversion = { kind: "callable-absence-completion", source, target };
      assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion), true);
      assert.equal(rustCompilerOwnedContextualConversionMatches(source,
        rustCallableTargetType([string], destination), conversion), false);
    }
  }
});

test("callable completion cannot invent required results or change native parameter carriers", () => {
  for (const [source, target] of [
    [rustCallableTargetType([], rustUnitTargetType()), rustCallableTargetType([], number)],
    [rustCallableTargetType([number], rustUnitTargetType()), rustCallableTargetType([string], rustOptionTargetType(number))],
    [rustCallableTargetType([number], rustUnitTargetType()), rustCallableTargetType([], rustOptionTargetType(number))],
    [rustCallableTargetType([], number), rustCallableTargetType([], rustOptionTargetType(number))],
  ]) {
    assert.equal(rustCallableAbsenceCompletionMatches(source, target), false);
  }
});
