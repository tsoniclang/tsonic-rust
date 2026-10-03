import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { selectRustSourceCallResult } from "../../../dist/policy/types/resolution/call-results.js";
import { rustSourceCallResultProjectionMatches } from "../../../dist/analysis/facts/source-call-results.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const integer = rustSourcePrimitiveTargetType("uint64");
const text = rustStringTargetType();
const nominal = { kind: "target-named", id: "fixture.Nominal" };
const derived = { kind: "target-named", id: "fixture.Derived" };
const unrelated = { kind: "target-named", id: "fixture.Unrelated" };
const nominalDefinition = { sourceName: "Nominal" };
const derivedDefinition = { sourceName: "Derived" };
const route = { kind: "closed", slot: "derived_view" };
const projectTypes = {
  definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, nominal) ? nominalDefinition
    : rustTargetTypeRefEquals(carrier, derived) ? derivedDefinition : undefined,
  relationship: (carrier, definition) => rustTargetTypeRefEquals(carrier, derived) && definition === nominalDefinition
    ? { kind: "related", targetType: nominal } : { kind: "unrelated" },
  downcastRoute: () => route,
};

function definitionsFor(entries) {
  const registry = createRustTypeDefinitionRegistry();
  for (const [carrier, arms] of entries) {
    assert.equal(registry.registerSourceUnion({ carrier, variants: arms.map((carrier, index) => ({ name: `Variant${index}`, carrier })) }, true), true);
  }
  return registry.seal();
}

test("checked source-call results project every exact closed nominal or primitive alternative", () => {
  const native = rustSourceUnionTargetType("/src/base.ts", "ReadResult");
  const definitions = definitionsFor([[native, [text, integer, nominal]]]);
  for (const selectedType of [text, integer, nominal]) {
    const result = selectRustSourceCallResult(projectTypes, native, () => selectedType, definitions);
    assert.equal(result.nativeType, native);
    assert.equal(result.selectedType, selectedType);
    assert.equal(result.projection.kind, "source-union");
    assert.equal(result.projection.variant, `Variant${[text, integer, nominal].indexOf(selectedType)}`);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.projection));
    assert.equal(rustSourceCallResultProjectionMatches(result.projection, result.projection,
      carrier => carrier, projectTypes, definitions), true);
  }
  assert.deepEqual(selectRustSourceCallResult(projectTypes, native, () => native, definitions), {
    nativeType: native, selectedType: native,
  });
});

test("closed result projection retains source absence, nominal ancestry and nested exact correspondence", () => {
  const native = rustSourceUnionTargetType("/src/base.ts", "ReadResult");
  const definitions = definitionsFor([[native, [text, nominal]]]);
  const optionalNative = rustOptionTargetType(native);
  const optionalResult = selectRustSourceCallResult(projectTypes, optionalNative, () => rustOptionTargetType(text), definitions);
  assert.equal(optionalResult.projection.sourceCarrier, optionalNative);
  assert.equal(optionalResult.projection.dispatchCarrier, native);
  assert.equal(optionalResult.projection.variant, "Variant0");
  const result = selectRustSourceCallResult(projectTypes, native, () => derived, definitions);
  assert.equal(result.projection.variant, "Variant1");
  assert.deepEqual(result.projection.project, {
    sourceCarrier: nominal, dispatchCarrier: nominal, targetCarrier: derived, projection: route,
  });
  assert.equal(rustSourceCallResultProjectionMatches(result.projection, result.projection,
    carrier => carrier, projectTypes, definitions), true);
});

test("closed result evidence rejects missing, ambiguous and stale native alternatives", () => {
  const native = rustSourceUnionTargetType("/src/base.ts", "ReadResult");
  const other = rustSourceUnionTargetType("/src/other.ts", "ReadResult");
  const definitions = definitionsFor([[native, [text, nominal]], [other, [integer, nominal]]]);
  for (const selectedType of [undefined, integer, unrelated, rustOptionTargetType(text)]) {
    assert.equal(selectRustSourceCallResult(projectTypes, native, () => selectedType, definitions), undefined);
  }
  const result = selectRustSourceCallResult(projectTypes, native, () => text, definitions);
  for (const mutation of [
    { ...result.projection, sourceCarrier: other },
    { ...result.projection, dispatchCarrier: other },
    { ...result.projection, variant: "Variant1" },
    { ...result.projection, selectedCarrier: nominal },
    { ...result.projection, added: true },
  ]) {
    assert.equal(rustSourceCallResultProjectionMatches(result.projection, mutation,
      carrier => carrier, projectTypes, definitions), false);
  }
  const nested = rustSourceUnionTargetType("/src/base.ts", "Nested");
  const duplicate = rustSourceUnionTargetType("/src/base.ts", "Duplicate");
  const ambiguous = definitionsFor([[native, [text, nominal]], [nested, [native, text]], [duplicate, [nominal, native]]]);
  assert.equal(selectRustSourceCallResult(projectTypes, nested, () => text, ambiguous), undefined);
  assert.equal(selectRustSourceCallResult(projectTypes, duplicate, () => derived, ambiguous), undefined);
});

test("checked optional result extraction preserves exact native widths and rejects unrelated carriers", () => {
  for (const selectedType of [integer, text, nominal]) {
    const native = rustOptionTargetType(selectedType);
    const result = selectRustSourceCallResult(projectTypes, native, () => selectedType);
    assert.equal(result.nativeType, native);
    assert.equal(result.selectedType, selectedType);
    assert.deepEqual(result.projection, {
      kind: "option-value", sourceCarrier: native, selectedCarrier: selectedType,
    });
    assert.equal(rustSourceCallResultProjectionMatches(result.projection, result.projection,
      carrier => carrier, projectTypes, definitionsFor([])), true);
    assert.equal(selectRustSourceCallResult(projectTypes, native, () => unrelated), undefined);
    assert.equal(selectRustSourceCallResult(projectTypes, native, () => undefined), undefined);
    assert.deepEqual(selectRustSourceCallResult(projectTypes, native, () => native), {
      nativeType: native, selectedType: native,
    });
  }
  assert.equal(selectRustSourceCallResult(projectTypes, rustOptionTargetType(integer),
    () => rustSourcePrimitiveTargetType("float64")), undefined);
});
