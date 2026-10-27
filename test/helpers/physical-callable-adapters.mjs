import assert from "node:assert/strict";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "./native-closure-producers.mjs";
import { rustNativeFixtureNodes } from "./records.mjs";
import { createRustProgramRecordBuilder } from "../../dist/analysis/program/records/create.js";
import { recordRustValueCarrierReconciliation } from "../../dist/analysis/program/records/value-carrier-admission.js";
import { createRustPlanningContext } from "../../dist/backend/planner/context.js";
import { analyzeRustErrorRegions } from "../../dist/analysis/errors/regions.js";
import { analyzeRustGenericErrorEmission } from "../../dist/analysis/callables/emission/generic-error-emission.js";
import { createRustErrorEmissionProducer } from "../../dist/analysis/program/records/error-emission.js";
import { analyzeRustCallableEmission } from "../../dist/analysis/conversions/callable-emission.js";
import { createRustCallableConversionProducer } from "../../dist/analysis/program/records/callable-conversions.js";
import { analyzeRustProjectEmission } from "../../dist/analysis/project-types/emission.js";
import { prepareRustProjectGenericMembership } from "../../dist/analysis/project-types/generic-membership.js";
import { createRustProjectEmissionProducer } from "../../dist/analysis/program/records/project-emission.js";
import { analyzeRustTypeEmission } from "../../dist/analysis/source-evidence/types/emission.js";
import { createRustTypeEmissionProducer } from "../../dist/analysis/program/records/type-emission.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../dist/policy/conversions/callable.js";
import { selectRustExactIntegerConversion } from "../../dist/policy/conversions/exact-integer.js";
import { planRustCallableConversion } from "../../dist/backend/planner/expressions/callable-conversions.js";

export function nativeFallibleAdapterFixture() {
  const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure");
  const current = nativeClosureProducerFixture({
    packages: [nativeClosureProducerFailurePackage(failure, { path: "original", result: "int64",
      parameters: [{ name: "value", type: "int32" }] })],
    source: `import { fail as original } from "test:producer";
import type { int32, int64 } from "@tsonic/core/types.js";
export function create(): (value: int32) => int64 {
  return (value: int32): int64 => { return original(value); };
}`,
    body: context => ({ kind: "try", expr: { kind: "call", path: "original", args: [{ kind: "path", path: "value" }] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType }),
  });
  const source = current.program.records.targetOperation.get(current.node).resultCarrier;
  const target = rustCallableTargetType([{ kind: "source-primitive", name: "int64" }], { kind: "source-primitive", name: "int32" });
  const conversion = selectRustCallableConversion(source, target, selectRustExactIntegerConversion, current.program.typeDefinitions);
  assert.equal(conversion !== undefined, true, "checked integer adaptation selected");
  const records = current.program.records;
  const builder = createRustProgramRecordBuilder(current.program.typeDefinitions, records);
  const required = [];
  recordRustValueCarrierReconciliation(builder, required, current.node, { kind: "conversion",
    fact: { sourceCarrier: source, targetCarrier: target, conversion } });
  const contextual = builder.seal(required);
  const selectedRecords = { ...records, contextualValueConversion: contextual.contextualValueConversion };
  const nativeNodes = rustNativeFixtureNodes(current.program);
  const nativeDomain = new Set(nativeNodes);
  const nativeTasks = nativeNodes.flatMap(node => {
    const selected = records.nativeTaskUse.get(node);
    return selected?.kind === "spawn" ? [{ node, operand: selected.operand, selection: selected.completion }] : [];
  });
  const sourceFiles = current.program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile);
  const regions = analyzeRustErrorRegions({ ast: current.program.source.ast, sourceFiles,
    isNativeNode: node => nativeDomain.has(node), records: selectedRecords, names: current.program.names,
    components: current.program.sourcePackageComponents, producers: current.program.callableValues.nativeProducers,
    definitions: current.program.typeDefinitions, callables: current.program.callableValues,
    promiseBodies: current.program.promiseBodies, nativeTasks, binaryHooks: current.program.binaryHooks });
  assert.equal(regions.kind, "resolved", "the exact constructed adapter inputs publish their required native error joins");
  const initialization = current.program.errorRegions.initialization;
  const owner = initialization.binary.lifecycle.region.localOwner;
  assert.equal(owner !== undefined, true, "the actual synchronous adapter fixture has its selected lifecycle owner");
  const lifecycle = regions.value.lifecycleFor([initialization.root,
    ...initialization.workers.map(worker => worker.initializer)], owner);
  assert.equal(lifecycle.kind, "resolved", "the actual initializer and task inventory select their native lifecycle");
  const errorRegions = regions.value.complete(initialization);
  const errors = createRustErrorEmissionProducer(() => {});
  analyzeRustGenericErrorEmission({ ast: current.program.source.ast, sourceFiles, nodes: nativeNodes,
    regions: errorRegions, index: current.program.genericCallableErrors,
    physical: current.program.callableValues.generic.physical, producer: errors });
  const program = { ...current.program, errorRegions, records: { ...selectedRecords,
    ...errors.records, nativeErrorRegion: errors.regions } };
  const adapters = createRustCallableConversionProducer(() => {});
  analyzeRustCallableEmission(program, nativeNodes, adapters);
  program.records = { ...program.records, ...adapters.records };
  const admitted = program.records.callableContract.get(current.node, conversion);
  assert.equal(admitted !== undefined, true, "the native conversion owner admits the exact selected adapter");
  const projects = createRustProjectEmissionProducer(() => {});
  analyzeRustProjectEmission({ program, nodes: nativeNodes, producer: projects,
    memberships: prepareRustProjectGenericMembership(program.declarationGenericRequirements) });
  program.records = { ...program.records, ...projects.records };
  const types = createRustTypeEmissionProducer(() => {});
  analyzeRustTypeEmission(program, nativeNodes, types, [admitted.physical.carrier, admitted.physical.error,
    ...admitted.physical.parameters, admitted.physical.result], projects);
  program.records = { ...program.records, ...types.records };
  current.context.input = createRustPlanningContext(program);
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "physical fallible producer plans");
  return { ...current, program, source, target, conversion, expression,
    adapt: () => planRustCallableConversion(conversion, expression, current.node, current.context) };
}
