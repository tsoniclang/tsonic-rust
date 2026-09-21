import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { hasRustProjectProjection, selectRustProjectProjectionImplementation } from "../../../dist/policy/types/project-projections.js";
import { createRustProjectProjectionRequirementCollector, createRustProjectProjectionImplementationIndex } from "../../../dist/analysis/declarations/project-projection-requirements.js";

const base = { declaration: {}, fileName: "/source.ts", sourceName: "Base", kind: "interface" };
const box = { declaration: {}, fileName: "/source.ts", sourceName: "Box", kind: "interface" };
const source = rustSourceTypeCarrier(base.fileName, base.sourceName, "object", []);
const target = type => rustSourceTypeCarrier(box.fileName, box.sourceName, "object", [{ kind: "type", type }]);
const numberType = { kind: "source-primitive", name: "float64" };
const stringType = { kind: "target-named", id: "rust.std.String", genericArguments: [] };
const open = target({ kind: "type-parameter", name: "Value" });
const routes = [numberType, stringType].map((type, index) => ({ source: base, target: box, targetCarrier: target(type), slot: `selected_${index}` }));
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
  assert.ok(Object.isFrozen(collector.seal()));
  const selected = createRustProjectProjectionImplementationIndex(collector.seal(), policy)(base);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(implementation => implementation.route), routes);
  const concrete = createRustProjectProjectionRequirementCollector(new Set(), policy);
  assert.equal(concrete.require({ sourceCarrier: source, targetCarrier: target(numberType) }), true);
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
