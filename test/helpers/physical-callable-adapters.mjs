import { createRustRecordFixture, rustNativeFixtureNodes } from "./records.mjs";
import assert from "node:assert/strict";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "./native-closure-producers.mjs";


import { createRustPlanningContext } from "../../dist/backend/planner/context.js";
import { analyzeRustErrorRegions } from "../../dist/analysis/errors/regions.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../dist/target-model/conversions/callable.js";
import { selectRustExactIntegerConversion } from "../../dist/target-model/conversions/exact-integer.js";
import { planRustCallableConversion } from "../../dist/backend/planner/expressions/callable-conversions.js";
import { rustCallableConversionPhysical, rustCallablePhysicalSignature } from "../../dist/target-model/conversions/callable-physical.js";
import { rustNativeCallableOperand } from "../../dist/analysis/callables/native-conversions.js";
import { publishRustCallablePhysicalConversion } from "../../dist/analysis/program/physical-emission-contexts.js";
import { nativeDeclarationSelectionInput } from "./native-type-selection.mjs";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

export function admitNativeCallableAdapter(current, conversion, node = current.node) {
  const program = current.program;
  const ast = program.source.ast;
  const owner = sourceEnclosingCallable(ast.parent(node), ast);
  assert.equal(owner !== undefined, true, "adapter admission has its original checked lexical owner");
  const context = program.physicalEmissionContexts.contextForOwner(owner, "native-body");
  assert.equal(context !== undefined, true, "adapter admission uses its exact actual physical context");
  const source = rustNativeCallableOperand(conversion.source, node, { records: program.records,
    storage: program.callableValues.nativeStorage, producers: program.callableValues.nativeProducers,
    definitions: program.typeDefinitions });
  assert.equal(source !== undefined, true, "fixture starts from the actual pre-seal selected native source");
  const file = ast.getFileName(ast.getSourceFile(node));
  const prepared = rustCallableConversionPhysical(conversion, source.signature, file, program.typeDefinitions,
    rustCallablePhysicalSignature);
  assert.equal(prepared !== undefined, true, "the existing physical producer admits the complete fixture adaptation");
  const selected = publishRustCallablePhysicalConversion(prepared, node,
    nativeDeclarationSelectionInput(program).nativeTypeInputFor(file, undefined));
  assert.equal(selected.kind, "resolved", "the canonical late owner admits all native error payloads");
  let origin;
  if (source.input !== undefined) origin = Object.freeze({ kind: "expression", subject: source.input.subject });
  else {
    const returned = program.callableValues.nativeStorage.returnFor(owner);
    assert.equal(returned.kind !== "unresolved" && rustTargetTypeRefEquals(returned.carrier, source.carrier), true,
      "the manual unit adapter retains its actual checked native return slot");
    origin = Object.freeze({ kind: "return", declaration: owner });
  }
  const adapter = Object.freeze({ node, selection: conversion, origin, joinOwnerFileName: file, sourceCarrier: source.carrier,
    sourceInput: source.input?.subject, conversion: selected.value });
  const selectedContext = Object.freeze({ ...context, callableAdapters: Object.freeze([...context.callableAdapters, adapter]) });
  const operands = program.physicalEmissionContexts.operands.map(operand => operand.context === context
    ? Object.freeze({ ...operand, context: selectedContext }) : operand);
  const byOperand = new Map(operands.map(operand => [operand.use, operand]));
  const physicalEmissionContexts = { ...program.physicalEmissionContexts,
    contexts: Object.freeze(program.physicalEmissionContexts.contexts.map(candidate => candidate === context ? selectedContext : candidate)),
    operands: Object.freeze(operands),
    contextFor: use => use === context.use ? selectedContext : program.physicalEmissionContexts.contextFor(use),
    contextForOwner: (subject, role) => subject === owner && role === "native-body" ? selectedContext
      : program.physicalEmissionContexts.contextForOwner(subject, role),
    operandFor: use => byOperand.get(use),
    sourceErrorOperandFor: (use, subject) => {
      const original = program.physicalEmissionContexts.sourceErrorOperandFor(use, subject);
      return original === undefined ? undefined : byOperand.get(original.use);
    } };
  current.context.input = createRustPlanningContext({ ...program, physicalEmissionContexts });
  current.context.emissionContext = selectedContext;
  return selected.value;
}

export function nativeFallibleAdapterFixture() {
  const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", [], [], undefined, [], undefined, []);
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
  const regions = analyzeRustErrorRegions({ ast: current.program.source.ast, sourceFiles: current.program.sourceFiles,
    isNativeNode: node => nativeNodes.has(node), records: selectedRecords, names: current.program.names,
    components: current.program.sourcePackageComponents, producers: current.program.callableValues.nativeProducers,
    definitions: current.program.typeDefinitions, callables: current.program.callableValues,
    promiseBodies: current.program.promiseBodies, helperEmissionRequests: [] });
  assert.equal(regions.kind, "resolved", "the exact constructed adapter inputs publish their required native error joins");
  const program = { ...current.program, records: selectedRecords,
    errorRegions: { declarationsFor: regions.value.declarationsFor, producerError: regions.value.producerError,
      initialization: current.program.errorRegions.initialization } };
  current.context.input = createRustPlanningContext(program);
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "physical fallible producer plans");
  const result = { ...current, program, source, target, conversion, expression };
  admitNativeCallableAdapter(result, conversion);
  return { ...result, adapt: () => planRustCallableConversion(conversion, expression, current.node, current.context) };
}
