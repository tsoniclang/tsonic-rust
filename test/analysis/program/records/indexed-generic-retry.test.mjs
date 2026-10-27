import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../../dist/analysis/program/carrier-probe.js";
import { finalizeProjectSourceGenericArguments } from "../../../../dist/analysis/operations/project-call-generics.js";
import { finalizeRustCallableSignature } from "../../../../dist/analysis/callables/calls/signature-query.js";
import { closedMetadataEquals } from "../../../../dist/target-model/metadata/closed-data.js";

// Families keyed by closed carrier metadata or physical owners, not by source nodes; the node snapshot skips them.
const closedMetadataKeyedFamilies = new Set(["typeEmission", "frameType", "structuralView", "classImplementationGenerics",
  "optionalStorageTypeArguments", "checkedProjectProjection", "structuralShape", "sourceUnion", "physicalProgramErrorBoundary",
  "projectUnionMapping", "projectUpcastEmission", "conversionContract", "carrierRead", "indexedRecordStorage", "projectClosedValue",
  "storedField", "structuralFieldStorage", "structuralObjectStorage", "structuralMethodInvocation", "projectRootEmission",
  "projectInstanceContracts", "receiverAlias"]);

for (const [keySource, evaluate] of [['"value"', false], ['`value`', false], ["selected()", true]]) {
  test(`indexed ${keySource} survives a pending outer generic callback and retries once`, () => {
    const { context, walk } = analyzeRustOperations(`
      let calls = 0;
      function selected(): "value" { calls++; return "value"; }
      function get<T, K extends keyof T, Result>(value: T, key: K, callback: () => Result): T[K] {
        callback();
        return value[key];
      }
      function width(value: string) { return value.length; }
      export function read(text: string) {
        const value = { value: 3 };
        return get(value, ${keySource}, () => width(text));
      }
    `);
    const { ast } = context;
    const parentRecords = context.records;
    const nodes = context.sourceStorage.nodes;
    const dependency = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "width");
    const call = nodes.find(node => {
      const callee = ast.is.IsCallExpression(node) ? Node_Expression(ast, node) : undefined;
      return callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === "get";
    });
    assert.equal(dependency !== undefined && call !== undefined, true);
    const callArguments = ast.arguments(call);
    const key = callArguments[1];
    const callback = callArguments[2];
    assert.equal(key !== undefined && callback !== undefined && ast.is.IsArrowFunction(callback), true);
    const selected = parentRecords.selectedCall.get(call);
    assert.equal(selected !== undefined, true, "the actual checker-selected project signature");
    const resultIndex = selected.member.genericParameters.findIndex(parameter => parameter.kind === "type" && parameter.sourceName === "Result");
    assert.equal(resultIndex >= 0, true);
    assert.equal(selected.sourceSelectedMethodTypeArguments[resultIndex].explicitTypeNode === undefined, true);
    assert.equal(selected.sourceArgumentBindings.some(binding => binding.sourceArgumentIndex === 2 &&
      binding.sourceParameterIndex === 2 && binding.sourceForm === "value"), true);
    const parentKey = parentRecords.indexedFieldKeyArgument.get(key);
    assert.equal(parentKey !== undefined, true, "the checked source already selected an indexed key");
    assert.equal(parentKey.evaluate, evaluate);
    const parentReaders = createRustRecordFixture({}, parentRecords);
    const parentSnapshot = Object.entries(parentReaders).filter(([family]) => !closedMetadataKeyedFamilies.has(family)).map(([family, reader]) => ({
      family, reader, values: nodes.map(node => reader.get(node)),
    }));
    const inherited = createRustRecordFixture({
      indexedFieldKeyArgument: { get: node => node === key ? undefined : parentRecords.indexedFieldKeyArgument.get(node) },
      sourceCallableReturn: { get: node => node === dependency || node === callback
        ? undefined : parentRecords.sourceCallableReturn.get(node) },
    }, parentRecords);
    const overlayParent = createRustProgramRecordBuilder(context.typeDefinitions, inherited);
    const probe = createRustCarrierProbe({ ...walk, inferredReturns: new WeakMap(), resolvingReturns: new Set([dependency]),
      context: { ...context, records: overlayParent } });
    const actualRecords = probe.context.records;
    let admissions = 0;
    const current = { ...probe, context: { ...probe.context, records: { ...actualRecords,
      indexedFieldKeys: { ...actualRecords.indexedFieldKeys, selected(...arguments_) {
        actualRecords.indexedFieldKeys.selected(...arguments_);
        admissions++;
      } },
    } } };
    overlayParent.seal([]);
    parentRecords.seal(context.requiredRecords);
    assert.equal(finalizeRustCallableSignature(current, dependency).kind, "unresolved", "the real dependency is in flight");
    assert.equal(finalizeProjectSourceGenericArguments(current, selected, callArguments, undefined) === undefined, true,
      "outer completion waits after its indexed key has been admitted");
    const firstKey = actualRecords.indexedFieldKeyArgument.get(key);
    assert.equal(firstKey !== undefined, true);
    assert.equal(closedMetadataEquals(firstKey, parentKey), true);
    assert.equal(firstKey.evaluate, evaluate);
    assert.equal(admissions, 1);
    assert.equal(current.context.requiredRecords.some(row => row.family === "indexedFieldKeyArgument" && row.subject === key), true);
    assert.equal(actualRecords.sourceCallableReturn.get(dependency) === undefined, true);
    assert.equal(actualRecords.sourceCallableReturn.get(callback) === undefined, true, "no provisional callback completion");
    current.resolvingReturns.delete(dependency);
    const completedDependency = finalizeRustCallableSignature(current, dependency);
    assert.equal(completedDependency.kind, "complete");
    assert.equal(completedDependency.result.returnCarrier.kind, "source-primitive");
    assert.equal(completedDependency.result.returnCarrier.name, "native-uint");
    assert.equal(actualRecords.sourceCallableReturn.get(dependency) === completedDependency.result, true);
    const complete = finalizeProjectSourceGenericArguments(current, selected, callArguments, undefined);
    assert.equal(complete !== undefined, true);
    assert.equal(complete.targetGenericArguments[resultIndex].kind, "type");
    assert.equal(complete.targetGenericArguments[resultIndex].type.kind, "source-primitive");
    assert.equal(complete.targetGenericArguments[resultIndex].type.name, "native-uint");
    const repeated = finalizeProjectSourceGenericArguments(current, selected, callArguments, undefined);
    assert.equal(repeated !== undefined, true);
    assert.equal(closedMetadataEquals(complete.targetGenericArguments, repeated.targetGenericArguments), true);
    assert.equal(actualRecords.indexedFieldKeyArgument.get(key) === firstKey, true);
    assert.equal(admissions, 1, "pending and complete retries share one actual key publication");
    const sealed = actualRecords.seal(current.context.requiredRecords);
    assert.equal(sealed.indexedFieldKeyArgument.get(key) === firstKey, true);
    for (const { family, reader, values } of parentSnapshot) {
      for (const [index, node] of nodes.entries()) assert.equal(reader.get(node) === values[index], true,
        `${family}: checked parent subject ${index} unchanged`);
    }
  });
}
