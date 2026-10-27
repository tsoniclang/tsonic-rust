import assert from "node:assert/strict";
import { createRustNativeCallableProtocolRegistry } from "../../dist/analysis/callables/native-protocols.js";
import { analyzeRustNativeProtocolEmission } from "../../dist/analysis/callables/native-protocol-emission.js";
import { createRustNativeProtocolProducer } from "../../dist/analysis/program/records/native-protocol-emission.js";
import { sealRustNativeCallableDispatch } from "../../dist/analysis/program/records/native-dispatch.js";
import { analyzeRustTypeEmission } from "../../dist/analysis/source-evidence/types/emission.js";
import { createRustTypeEmissionProducer } from "../../dist/analysis/program/records/type-emission.js";
import { analyzeRustProjectEmission } from "../../dist/analysis/project-types/emission.js";
import { prepareRustProjectGenericMembership } from "../../dist/analysis/project-types/generic-membership.js";
import { createRustProjectEmissionProducer } from "../../dist/analysis/program/records/project-emission.js";
import { planRustNativeCallableProtocol } from "../../dist/backend/planner/declarations/callables/native-protocols.js";
import { planRustNativeProducerBridge } from "../../dist/backend/planner/declarations/callables/native-producer-bridges.js";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { createRustGeneratedUnionPlan } from "../../dist/analysis/objects/shapes/generated-union-plan.js";
import { rustCallableTargetType } from "../../dist/target-model/types/index.js";
import { createRustSourceFile } from "../../dist/backend/target-ast/syntax/nodes.js";
import { finalizeRustSourceStyle } from "../../dist/backend/target-ast/normalization/source-style.js";
import { analyzeRust } from "./rust-session.mjs";
import { rustProgramSourceFiles, rustSourceFilePlanContext } from "./plan-context.mjs";
import { printRustSourceFile } from "./printed-rust-source.mjs";

// A protocol bound to a probe program's own source file, with the native protocol and type emission records that the
// analysis owners (analyzeRustNativeProtocolEmission, analyzeRustTypeEmission) select for it. The planner context is
// the probe source file's planning context, so the planner reads only sealed records, as in a real compilation.
export function nativeProducerFixture({
  parameters = [], result, carrier = rustCallableTargetType(parameters, result),
  definitions = createRustTypeDefinitionRegistry(), identity = "producer-proof", usedNames = new Set(),
  protocols = createRustNativeCallableProtocolRegistry({ definitions, usedNames,
    structuralShapes: { instantiateSourceCarrier() { assert.fail("these native producer fixtures have no structural output"); } } }),
} = {}) {
  const { program: base } = analyzeRust({ files: { "index.ts": "export function probe(): void {}\n" } });
  const [sourceFile] = rustProgramSourceFiles(base);
  const unionPlan = createRustGeneratedUnionPlan(definitions.generatedUnions(), fileName => {
    const component = base.sourcePackageComponents.componentForFile(fileName);
    assert.equal(component !== undefined, true, `${identity}: generated union has its actual source-package owner`);
    return component.componentId;
  }, new Map());
  const structuralShapes = Object.freeze({ ...base.structuralShapes,
    unionDefinitions: unionPlan.unionDefinitions, unionForCarrier: unionPlan.unionForCarrier });
  const protocol = protocols.bind(base.source.ast.getFileName(sourceFile), carrier)?.protocol;
  assert.equal(protocol !== undefined, true, `${identity}: protocol exists`);
  const selectedProtocols = protocols.definitions();
  const sourceProtocols = new Map(selectedProtocols.map(selected => [selected.targetName, selected]));
  const nativeInputs = Object.freeze({ ...base.callableValues.native, protocols: selectedProtocols,
    protocolForSourceItem: (fileName, typeName) => {
      const selected = sourceProtocols.get(typeName);
      return selected?.ownerFileName === fileName ? selected : undefined;
    } });
  const native = createRustNativeProtocolProducer(() => {});
  const callableValues = { ...base.callableValues,
    native: nativeInputs,
    nativeDispatch: sealRustNativeCallableDispatch(new Map(selectedProtocols.map(selected =>
      [selected, selected === protocol]))) };
  const issues = analyzeRustNativeProtocolEmission({ program: { ...base, typeDefinitions: definitions, callableValues },
    sourceFiles: [sourceFile], producer: native });
  assert.deepEqual(issues, [], `${identity}: native protocol emission`);
  const withProtocols = { ...base, typeDefinitions: definitions, callableValues, structuralShapes,
    records: { ...base.records, nativeProtocol: native.protocol, nativeProtocols: native.inventories } };
  const projects = createRustProjectEmissionProducer(() => {});
  analyzeRustProjectEmission({ program: withProtocols, nodes: [], producer: projects,
    memberships: prepareRustProjectGenericMembership(withProtocols.declarationGenericRequirements) });
  const admitted = { ...withProtocols, records: { ...withProtocols.records, ...projects.records } };
  const emission = createRustTypeEmissionProducer(() => {});
  analyzeRustTypeEmission(admitted, [], emission, [], projects);
  const program = { ...admitted, records: { ...admitted.records, ...emission.records } };
  return { protocol, context: rustSourceFilePlanContext(program, sourceFile), definitions, program };
}

export function nativeProducerItems(fixture) {
  const trait = planRustNativeCallableProtocol(fixture.protocol, fixture.context);
  const bridge = planRustNativeProducerBridge(fixture.protocol, fixture.context);
  assert.equal(trait !== undefined, true, "protocol trait renders");
  assert.equal(bridge !== undefined, true, "producer bridge renders");
  return [trait, ...bridge];
}

export function printNativeProducerItems(items) {
  return printRustSourceFile(finalizeRustSourceStyle(createRustSourceFile(items)));
}
