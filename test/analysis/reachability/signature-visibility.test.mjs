import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustSignatureVisibility } from "../../../dist/analysis/reachability/signature-visibility.js";
import { createRustSourcePackageEmissionProducer } from "../../../dist/analysis/program/records/program/source-packages.js";
import { rustInfallibleTargetId, rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";

const carrier = (file, name) => rustSourceTypeCarrier(file, name, "object");

function close(declarations) {
  const nodes = declarations.map(value => Object.freeze({ ...value }));
  const source = { ast: { getSourceFile: node => node.file, getFileName: file => file } };
  const components = [{ componentId: "project", structuralShapesModuleName: "shapes" }];
  const records = createRustRecordFixture({
    sourcePackageComponents: { get: () => components },
    nativeDeclaration: { get: node => nodes.includes(node) ? { kind: "interface", name: node.name,
      fields: (node.dependencies ?? []).map(carrier => ({ carrier })) } : undefined },
    declarationLiveness: { get: node => ({ visibility: node.public ? "public" : "crate" }) },
    programErrorVariants: { get: () => [] },
  });
  const identities = new Map(nodes.map(node => [node.file, { componentId: "project", moduleName: node.file }]));
  const producer = createRustSourcePackageEmissionProducer(() => {});
  analyzeRustSignatureVisibility({
    source, records, sourceOutputIdentities: identities,
    callableValues: { generic: { physical: { definitions: () => [] } } },
    projectTypes: { definitionForCarrier: () => undefined },
    structuralShapes: { definitionForCarrier: () => undefined },
    errorRegions: { initialization: { binary: {
      lifecycle: { carrier: { kind: "target-named", id: rustInfallibleTargetId } },
    } } },
  }, nodes, producer);
  return { nodes, selected: producer.records.signatureVisibility.get("project") };
}

test("source public signatures close exact transitive module dependencies without unrelated names", () => {
  const { selected, nodes } = close([
    { file: "api", name: "View", public: true, dependencies: [carrier("base", "BaseDispatch")] },
    { file: "base", name: "BaseDispatch", dependencies: [carrier("leaf", "Leaf")] },
    { file: "base", name: "Hidden" }, { file: "leaf", name: "Leaf" }, { file: "leaf", name: "Hidden" },
  ]);
  assert.deepEqual([...selected.requiredByModule.get("base")], ["BaseDispatch"]);
  assert.deepEqual([...selected.requiredByModule.get("leaf")], ["Leaf"]);
  assert.equal(nodes[1].public, undefined, "analysis never mutates authored declaration visibility");
  assert.equal(Object.isFrozen(selected), true, "the complete visibility payload is published once");
});

test("source private signatures and same-spelled declarations remain outside the public closure", () => {
  const { selected } = close([
    { file: "owner", name: "Private", dependencies: [carrier("leaf", "Leaf")] },
    { file: "owner", name: "Public", public: true, dependencies: [] },
    { file: "leaf", name: "Leaf" }, { file: "other", name: "Leaf" },
  ]);
  assert.equal(selected.requiredByModule.has("leaf"), false);
  assert.equal(selected.requiredByModule.has("other"), false);
  assert.deepEqual([...selected.requiredByModule.get("owner")], ["Public"]);
});

test("source scoped dependencies expose their owner but not another scope's namesake", () => {
  const { selected } = close([
    { file: "api", name: "Envelope", public: true, dependencies: [carrier("first_scope", "Entry")] },
    { file: "first_scope", name: "Entry", dependencies: [carrier("values", "Payload")] },
    { file: "second_scope", name: "Entry" },
    { file: "values", name: "Payload", dependencies: [carrier("inner", "Inner")] },
    { file: "values", name: "Entry" }, { file: "inner", name: "Inner" },
  ]);
  assert.deepEqual([...selected.requiredByModule.get("first_scope")], ["Entry"]);
  assert.equal(selected.requiredByModule.has("second_scope"), false);
  assert.deepEqual([...selected.requiredByModule.get("values")], ["Payload"]);
  assert.deepEqual([...selected.requiredByModule.get("inner")], ["Inner"]);
});

test("already public native declarations retain their exact published membership", () => {
  const { selected } = close([{ file: "internal", name: "UnusedPublic", public: true }]);
  assert.deepEqual([...selected.requiredByModule.get("internal")], ["UnusedPublic"]);
});
