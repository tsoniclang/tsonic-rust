import { createRustRecordFixture, rustNativeFixtureNodes } from "./records.mjs";
import assert from "node:assert/strict";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "./native-closure-producers.mjs";


import { createRustPlanningContext } from "../../dist/backend/planner/context.js";
import { analyzeRustErrorRegions } from "../../dist/analysis/errors/regions.js";
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
  const selectedRecords = createRustRecordFixture({ contextualValueConversion: { get: node => node === current.node
    ? { sourceCarrier: source, targetCarrier: target, conversion } : records.contextualValueConversion.get(node) } }, records);
  const nativeNodes = new Set(rustNativeFixtureNodes(current.program));
  const nativeTasks = [...nativeNodes].flatMap(node => {
    const selected = records.nativeTaskUse.get(node);
    return selected?.kind === "spawn" ? [{ node, operand: selected.operand, selection: selected.completion }] : [];
  });
  const regions = analyzeRustErrorRegions({ ast: current.program.source.ast, sourceFiles: current.program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile),
    isNativeNode: node => nativeNodes.has(node), records: selectedRecords, names: current.program.names,
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
  const program = { ...current.program, records: selectedRecords,
    errorRegions: regions.value.complete(initialization) };
  current.context.input = createRustPlanningContext(program);
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "physical fallible producer plans");
  return { ...current, program, source, target, conversion, expression,
    adapt: () => planRustCallableConversion(conversion, expression, current.node, current.context) };
}
