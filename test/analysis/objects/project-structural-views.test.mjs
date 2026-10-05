import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { receiverFieldStorageCases } from "../../../../tsonic/test/fixtures/receiver-field-storage-cases.mjs";
import { generalizeRustProjectStructuralView } from "../../../dist/analysis/objects/project-structural-views-generics.js";
import { rustProjectViewMatches } from "../../../dist/analysis/objects/view-implementations.js";
import { rustSourceTypeCarrier, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";

const parameter = { kind: "type-parameter", identity: "source:Value", name: "Value" };
const otherParameter = { kind: "type-parameter", identity: "destination:Value", name: "Value" };
const text = { kind: "source-primitive", name: "string" };
const number = { kind: "source-primitive", name: "float64" };
const source = (type, name = "Box") => rustSourceTypeCarrier("/model.ts", name, "object", [{ kind: "type", type }]);
const target = (type, options = {}) => rustStructuralObjectTargetType(options.file ?? "/view.ts", [
  { sourceName: "value", type, presence: options.presence ?? "required", readonly: options.readonly ?? true },
]);

test("native structural view selection instantiates the same exact source and destination binder", () => {
  const view = { sourceCarrier: source(parameter), targetCarrier: target(parameter) };
  for (const type of [text, number, otherParameter]) {
    assert.equal(rustProjectViewMatches(view, source(type), target(type)), true);
  }
  assert.equal(rustProjectViewMatches(view, source(text), target(number)), false);
  assert.equal(rustProjectViewMatches(view, source(otherParameter), target(parameter)), false);
  assert.equal(rustProjectViewMatches(view, source(text, "Other"), target(text)), false);
  assert.equal(rustProjectViewMatches(view, source(text), target(text, { file: "/foreign.ts" })), false);
  assert.equal(rustProjectViewMatches(view, source(text), target(text, { presence: "optional" })), false);
  assert.equal(rustProjectViewMatches(view, source(text), target(text, { readonly: false })), false);
  assert.equal(rustProjectViewMatches({ ...view, targetCarrier: target(otherParameter) }, source(text), target(text)), false);
});

test("monomorphic structural views retain exact carriers without introducing a generic match", () => {
  const view = { sourceCarrier: source(text), targetCarrier: target(text) };
  assert.equal(rustProjectViewMatches(view, source(text), target(text)), true);
  assert.equal(rustProjectViewMatches(view, source(number), target(number)), false);
});

test("structural generic selection reuses exact retained member proof without reconstructing checker evidence", () => {
  const declaration = {};
  const member = {};
  const retained = { declaration, sourceCarrier: source(parameter), targetCarrier: target(parameter),
    fields: [{ declaration: member, storageIndex: 0 }] };
  const selected = { ...retained, sourceCarrier: source(text), targetCarrier: target(text) };
  const definition = {};
  const walk = { context: {
    projectTypes: { definitionForDeclaration: () => definition, isPolymorphic: () => true, openCarrier: () => source(parameter) },
    classValues: { instanceViewRequests: () => [retained] },
    semanticsFor() { assert.fail("an exact retained native member proof must not be rebuilt"); },
  } };
  assert.equal(generalizeRustProjectStructuralView(selected, {}, walk) === retained, true);
});

test("nonpolymorphic structural implementations keep their selected optional and callable adapters", () => {
  const view = { declaration: {}, sourceCarrier: source(text), targetCarrier: target(text), fields: [{ callable: {} }] };
  const walk = { context: {
    projectTypes: { definitionForDeclaration: () => ({}), isPolymorphic: () => false,
      openCarrier() { assert.fail("a direct concrete root does not require a polymorphic supertrait"); } },
  } };
  assert.equal(generalizeRustProjectStructuralView(view, {}, walk) === view, true);
});

for (const surfaces of [[], ["js"]]) {
  test(`generic live structural views use the class binder instead of a selected String supertrait in ${surfaces[0] ?? "native"}`, () => {
    const example = receiverFieldStorageCases.find(entry => entry.name === "generic-deferred-non-copy-view");
    assert.equal(example !== undefined, true);
    const { program } = analyzeRust({ surfaces, files: { "index.ts": example.source } });
    const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Box");
    assert.equal(definition !== undefined, true, "the exact Box source owner exists");
    const views = program.classValues.instanceViews.filter(view => view.declaration === definition.declaration);
    assert.equal(views.length > 0, true, "the requested native live view exists");
    for (const view of views) {
      assert.equal(rustTargetTypeRefEquals(view.sourceCarrier, program.projectTypes.openCarrier(definition)), true,
        "the native view implementation uses the open class owner");
      assert.deepEqual(rustTargetGenericReferences(view.targetCarrier).typeIdentities, definition.typeParameterIdentities);
      const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
      assert.equal(shape !== undefined, true);
      assert.equal(shape.fields.length, 1);
      assert.equal(view.fields[0].readAdapter.kind, "identity");
      assert.equal(view.fields[0].field !== undefined, true, "the exact selected source field remains available");
      assert.equal(rustTargetTypeRefEquals(view.fields[0].field.resultCarrier, shape.fields[0].type), true,
        "the native selected member and destination storage share the same exact binder");
      assert.equal(view.fields[0].field.dispatch !== undefined, true, "live nominal dispatch remains intact");
    }
    assert.equal(program.classValues.instanceViewImplementations.filter(view => view.declaration === definition.declaration).length, 1,
      "closed requests share one native generic implementation");
  });
}
