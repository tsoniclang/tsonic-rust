import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { hasRustProjectProjection, selectRustProjectProjection, selectRustProjectProjectionImplementation } from "../../../dist/policy/types/project-projections.js";
import { classifyCarrierRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { createRustProjectProjectionRequirementCollector, createRustProjectProjectionImplementationIndex } from "../../../dist/analysis/declarations/project-projection-requirements.js";

const base = { declaration: {}, fileName: "/source.ts", sourceName: "Base", kind: "interface" };
const box = { declaration: {}, fileName: "/source.ts", sourceName: "Box", kind: "interface" };
const source = rustSourceTypeCarrier(base.fileName, base.sourceName, "object", []);
const target = type => rustSourceTypeCarrier(box.fileName, box.sourceName, "object", [{ kind: "type", type }]);
const numberType = { kind: "source-primitive", name: "float64" };
const stringType = { kind: "target-named", id: "rust.std.String", genericArguments: [] };
const open = target({ kind: "type-parameter", name: "Value" });

test("structural checked slots preserve exact bases and propagate static member requirements", () => {
  const field = type => ({ sourceName: "value", type, presence: "required", readonly: true });
  const structural = rustStructuralObjectTargetType("/source.ts", [field({ kind: "type-parameter", name: "Value" })], "reference", undefined, [source]);
  const checked = { ...policy, checkedProjectionSlot: definition => definition === base ? "project_base" : undefined };
  assert.deepEqual(selectRustProjectProjection(source, structural, checked), { kind: "structural", slot: "project_base" });
  assert.equal(selectRustProjectProjection(source, structural, { ...checked, checkedProjectionSlot: () => undefined }), undefined);
  assert.equal(selectRustProjectProjection(source,
    rustStructuralObjectTargetType("/source.ts", [field(numberType)]), checked), undefined);
  const requirements = new Map([["Value", new Set()]]);
  assert.equal(classifyCarrierRequirements(structural, ["static"], new Set(["Value"]), requirements,
    () => false, emptyRustTypeDefinitions), true);
  assert.deepEqual([...requirements.get("Value")], ["static"]);
  const borrowed = rustStructuralObjectTargetType("/source.ts", [field({ kind: "reference", mutable: false,
    lifetime: { kind: "placeholder" }, referent: numberType })], "reference", undefined, [source]);
  assert.equal(selectRustProjectProjection(source, borrowed, checked), undefined);
  assert.equal(classifyCarrierRequirements(borrowed, ["static"], new Set(), new Map(), () => false, emptyRustTypeDefinitions), false);
});
const routes = [numberType, stringType].map((type, index) => ({ kind: "closed", source: base, target: box, targetCarrier: target(type), slot: `selected_${index}` }));
const policy = {
  definitionForCarrier(carrier) {
    const value = rustSourceTypeCarrierValue(carrier);
    return value?.typeName === "Base" ? base : value?.typeName === "Box" ? box : undefined;
  },
  relationship(carrier, definition) {
    return definition === base && rustSourceTypeCarrierValue(carrier)?.typeName === "Box"
      ? { kind: "related", targetType: source } : { kind: "unrelated" };
  },
  downcastRoutesFor: definition => definition === base ? routes : [],
  downcastRoute: (definition, carrier) => definition === base ? routes.find(route => rustTargetTypeRefEquals(carrier, route.targetCarrier)) : undefined,
};

test("closed generic projection contracts retain distinct exact native routes", () => {
  assert.equal(hasRustProjectProjection(source, open, policy), true);
  const collector = createRustProjectProjectionRequirementCollector(new Set(["Value"]), policy);
  assert.equal(collector.require({ sourceCarrier: source, targetCarrier: open }), true);
  assert.equal(collector.require({ sourceCarrier: source, targetCarrier: open }), true);
  assert.equal(collector.seal().length, 1);
  assert.equal(collector.seal()[0].requiresBound, true);
  assert.ok(Object.isFrozen(collector.seal()));
  const selected = createRustProjectProjectionImplementationIndex(collector.seal(), policy)(base);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(implementation => implementation.route), routes);
  const concrete = createRustProjectProjectionRequirementCollector(new Set(), policy);
  assert.equal(concrete.require({ sourceCarrier: source, targetCarrier: target(numberType) }), true);
  assert.equal(concrete.seal()[0].requiresBound, false);
  assert.equal(createRustProjectProjectionImplementationIndex(concrete.seal(), policy)(base).length, 1);
});

test("missing binders, unsupported closed types and mismatched projection identities fail closed", () => {
  assert.equal(createRustProjectProjectionRequirementCollector(new Set(), policy).require({ sourceCarrier: source, targetCarrier: open }), false);
  const missing = target({ kind: "source-primitive", name: "bool" });
  assert.equal(hasRustProjectProjection(source, missing, policy), false);
  assert.equal(selectRustProjectProjectionImplementation({ sourceCarrier: source, targetCarrier: missing }, routes[0], policy), undefined);
  assert.equal(hasRustProjectProjection(target(numberType), open, policy), false);
  const broken = { ...policy, relationship: () => ({ kind: "ambiguous", targetTypes: [source] }) };
  assert.equal(hasRustProjectProjection(source, open, broken), false);
  assert.equal(selectRustProjectProjectionImplementation({ sourceCarrier: source, targetCarrier: open }, routes[0], broken), undefined);
});

test("checked generic projections belong to their generic target, never the base package", () => {
  const checked = {
    ...policy,
    openCarrier: definition => definition === base ? source : open,
    downcastRoute: (definition, carrier) => definition === base &&
      rustSourceTypeCarrierValue(carrier)?.typeName === "Box"
      ? { kind: "checked", source: base, target: box, targetCarrier: carrier, slot: "project_base" }
      : undefined,
  };
  const collector = createRustProjectProjectionRequirementCollector(new Set(["Value"]), checked);
  assert.equal(collector.require({ sourceCarrier: source, targetCarrier: open }), true);
  assert.equal(collector.require({ sourceCarrier: source, targetCarrier: target(numberType) }), true);
  assert.equal(collector.require({ sourceCarrier: source, targetCarrier: target(stringType) }), true);
  assert.ok(collector.seal().every(requirement => requirement.requiresBound === false));
  const index = createRustProjectProjectionImplementationIndex(collector.seal(), checked);
  assert.deepEqual(index(base), []);
  assert.equal(index(box).length, 1);
  assert.equal(index(box)[0].genericOwner, box);
  assert.ok(rustTargetTypeRefEquals(index(box)[0].route.targetCarrier, open));
  assert.ok(Object.isFrozen(index(box)));
  assert.ok(Object.isFrozen(index(box)[0]));
  assert.equal(createRustProjectProjectionRequirementCollector(new Set(), checked)
    .require({ sourceCarrier: source, targetCarrier: open }), false);
  assert.throws(() => createRustProjectProjectionImplementationIndex(collector.seal(), {
    ...checked, relationship: () => ({ kind: "unrelated" }),
  }), /lost its generic native relationship/);
});
