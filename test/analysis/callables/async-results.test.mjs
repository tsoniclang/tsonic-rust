import assert from "node:assert/strict";
import test from "node:test";
import { selectRustAsyncBodyPromise } from "../../../dist/analysis/callables/async-results.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustNativeRepresentationMatches } from "../../../dist/target-model/conversions/native-representation.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import {
  rustAbsenceTargetType,
  rustFutureTargetType,
  rustJsErrorTargetType,
  rustJsPromiseTargetTypeWithLifetime,
  rustNeverTargetType,
  rustSourceOptionalTargetType,
  rustSourcePrimitiveTargetType,
  rustSourceUnionTargetType,
  rustUnitTargetType,
} from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const owned = { kind: "static" };
const borrowed = { kind: "parameter", identity: "scope::borrow", name: "borrow" };
const unit = rustUnitTargetType();
const integer = rustSourcePrimitiveTargetType("int64");
const string = rustSourcePrimitiveTargetType("string");
const optional = rustSourceOptionalTargetType(integer);
const promise = (output, lifetime = owned, error) => rustJsPromiseTargetTypeWithLifetime(output, lifetime, error);
const result = rustSourceUnionTargetType("/src/result.ts", "Completion");
const definitionsFor = alternatives => ({
  programErrorOrigin: () => undefined,
  sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, result)
    ? alternatives.map((carrier, index) => ({ name: `Case${index}`, carrier })) : undefined,
});
const select = (output, contextual, definitions = emptyRustTypeDefinitions) =>
  selectRustAsyncBodyPromise(promise(output), output, contextual, definitions);

test("async body selection constructs the unique contextual output rather than mapping a promise", () => {
  for (const output of [unit, rustAbsenceTargetType(), integer, rustNeverTargetType()]) {
    for (const contextual of [promise(optional), rustSourceOptionalTargetType(promise(optional)), result]) {
      const selected = select(output, contextual, definitionsFor([integer, promise(optional)]));
      assert.equal(selected.kind, "selected");
      assert.equal(rustTargetTypeRefEquals(selected.outputCarrier, optional), true);
      assert.equal(rustTargetTypeRefEquals(selected.contextualPromise, promise(optional)), true);
      assert.equal(rustTargetTypeRefEquals(selected.errorCarrier, promise(unit).genericArguments[2].type), true);
      assert.equal(Object.isFrozen(selected), true);
    }
  }
  assert.equal(selectRustSourceValueConversion(promise(unit), promise(optional)) === undefined, true,
    "constructed invariant promises are not widened by the body selection");
});

test("async selection proves compatible outputs, not names, ordering or unrelated synchronous branches", () => {
  for (const alternatives of [[promise(integer), promise(string)], [promise(string), promise(integer)]]) {
    const selected = select(integer, result, definitionsFor(alternatives));
    assert.equal(selected.kind, "selected");
    assert.equal(rustTargetTypeRefEquals(selected.outputCarrier, integer), true);
  }
  const middle = rustSourceUnionTargetType("/src/result.ts", "Nested");
  const definitions = {
    programErrorOrigin: () => undefined,
    sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, result)
      ? [{ name: "PromiseMisleadingName", carrier: integer }, { name: "Ordinary", carrier: middle }]
      : rustTargetTypeRefEquals(carrier, middle)
        ? [{ name: "NotPromiseByName", carrier: promise(optional) }, { name: "Other", carrier: string }]
        : undefined,
  };
  const selected = select(unit, result, definitions);
  assert.equal(selected.kind, "selected");
  assert.equal(rustTargetTypeRefEquals(selected.outputCarrier, optional), true);
});

test("multiple admissible async outputs and rejection-carrier changes fail closed", () => {
  for (const [output, alternatives] of [
    [unit, [promise(optional), promise(rustSourceOptionalTargetType(string))]],
    [integer, [promise(integer), promise(optional)]],
    [unit, [promise(optional), promise(optional, borrowed)]],
  ]) assert.equal(select(output, result, definitionsFor(alternatives)).kind, "rejected");
  assert.equal(select(unit, promise(integer)).kind, "rejected", "required output cannot manufacture a value");
  assert.equal(select(integer, promise(string)).kind, "rejected", "unrelated native outputs remain unrelated");
  assert.equal(select(unit, promise(optional, owned, rustJsErrorTargetType())).kind, "rejected");
});

test("contextual selection retains exact borrowed lifetimes for the existing storage owner to prove", () => {
  const expected = promise(optional, borrowed);
  const selected = select(unit, expected);
  assert.equal(selected.kind, "selected");
  assert.equal(rustTargetTypeRefEquals(selected.contextualPromise, expected), true);
  assert.equal(rustNativeRepresentationMatches(promise(optional), selected.contextualPromise), false,
    "selecting an output does not authorize a static/borrowed lifetime conversion");
  assert.equal(rustNativeRepresentationMatches(promise(optional, borrowed), selected.contextualPromise), true);
});

test("non-promise contexts preserve inferred output and opaque native Future stays a separate protocol", () => {
  for (const contextual of [undefined, unit, integer, result]) {
    const selected = select(integer, contextual, definitionsFor([integer, string]));
    assert.equal(selected.kind, "selected");
    assert.equal(rustTargetTypeRefEquals(selected.outputCarrier, integer), true);
    assert.equal(selected.contextualPromise === undefined, true);
  }
  assert.equal(selectRustAsyncBodyPromise(rustFutureTargetType(integer), integer,
    promise(optional), emptyRustTypeDefinitions).kind, "rejected");
});

test("async output selection retains bounded metadata, recursive-union and accessor guards", () => {
  const cyclic = {
    programErrorOrigin: () => undefined,
    sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, result)
      ? [{ name: "Self", carrier: result }] : undefined,
  };
  assert.equal(select(unit, result, cyclic).kind, "rejected");
  const oversized = definitionsFor(Array.from({ length: 4097 }, () => promise(optional)));
  assert.equal(select(unit, result, oversized).kind, "rejected");
  let reads = 0;
  const accessor = Object.defineProperty({}, "kind", { get() { reads += 1; return "target-named"; } });
  for (const malformed of [null, undefined, true, {}, accessor,
    { ...promise(unit), genericArguments: [] }, { ...promise(unit), extra: true }]) {
    assert.equal(selectRustAsyncBodyPromise(malformed, unit, promise(optional), emptyRustTypeDefinitions).kind, "rejected");
    if (malformed !== undefined) assert.equal(select(unit, malformed).kind, "rejected");
  }
  assert.equal(reads, 0);
});
