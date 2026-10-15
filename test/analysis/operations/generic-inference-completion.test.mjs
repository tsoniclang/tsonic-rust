import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { finalizeProjectSourceGenericArguments } from "../../../dist/analysis/operations/project-call-generics.js";

for (const argument of ["() => width(value)", "(() => width(value))", "{ read: () => width(value) }", "[() => width(value)]"]) {
  const object = argument.startsWith("{");
  const array = argument.startsWith("[");
  const parameter = object ? "{ read: () => T }" : array ? "Array<() => T>" : "() => T";
  const invocation = object ? "callback.read()" : array ? "callback[0]()" : "callback()";
  test(`a pending generic callback in ${object ? "an object" : array ? "an array" : argument.startsWith("((") ? "parentheses" : "a direct argument"} cannot finalize a checker baseline`, () => {
    const { context, walk } = analyzeRustOperations(`
function consume<T>(callback: ${parameter}): T { return ${invocation}; }
function width(value: string) { return value.length; }
export function run(value: string) { return consume(${argument}); }
`);
    const { ast, records } = context;
    const dependency = context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "width");
    const call = context.sourceStorage.nodes.find(node => {
      const callee = ast.is.IsCallExpression(node) ? Node_Expression(ast, node) : undefined;
      return callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === "consume";
    });
    assert.equal(dependency !== undefined && call !== undefined, true);
    const selected = records.selectedCall.get(call);
    assert.equal(selected !== undefined, true);
    const inherited = createRustRecordFixture({ sourceCallableReturn: {
      get: node => node === dependency || ast.is.IsArrowFunction(node) ? undefined : records.sourceCallableReturn.get(node),
    } }, records);
    const current = createRustCarrierProbe({ ...walk, inferredReturns: new WeakMap(), resolvingReturns: new Set([dependency]),
      context: { ...context, records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
    const arguments_ = ast.arguments(call);
    assert.equal(finalizeProjectSourceGenericArguments(current, selected, arguments_, undefined) === undefined, true,
      "a demanded pending callback is not a missing inference contribution");
    assert.equal(current.context.records.sourceCallableReturn.get(dependency) === undefined, true);
    current.resolvingReturns.delete(dependency);
    const complete = finalizeProjectSourceGenericArguments(current, selected, arguments_, undefined);
    assert.equal(complete !== undefined, true);
    const type = complete.targetGenericArguments.find(value => value.kind === "type");
    assert.equal(type?.type.kind, "source-primitive");
    assert.equal(type.type.name, "native-uint");
  });
}
