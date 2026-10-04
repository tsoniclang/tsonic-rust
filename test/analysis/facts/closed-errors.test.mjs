import assert from "node:assert/strict";
import test from "node:test";
import { rustClosedErrorTransportDemand } from "../../../dist/analysis/facts/closed-errors.js";
import { rustContextualValueConversionFactKey, rustFlowReadProjectionFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { selectRustProgramErrorConversion } from "../../../dist/target-model/conversions/program-error.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustJsErrorTargetType, rustJsValueTargetType, rustTsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustRetainedErrorTargetType, rustSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";

const projectTypes = { sourceErrorDefinitions: [], sourceCreatedErrorOrigins: [],
  definitionForCarrier: () => undefined, sourceErrorCarrier: rustSourceErrorTargetType };

function scenario(source, mutate = operation => operation) {
  const expression = { kind: "KindIdentifier", children: [] };
  const statement = { kind: "KindThrowStatement", expression, children: [expression] };
  const file = { kind: "KindSourceFile", children: [statement] };
  const operation = mutate({ kind: "throw-op", operationId: "tsonic.rust.error.throw",
    error: { kind: "conversion", expression, conversion: selectRustProgramErrorConversion(source) } });
  const facts = { get: (node, key) => node === statement && key === rustTargetOperationFactKey ? operation
    : node === expression && key === rustRuntimeCarrierKey ? { carrier: source } : undefined };
  facts.getFact = facts.get;
  facts.getTargetConversionFact = () => undefined;
  facts.getRuntimeCarrierFact = node => facts.get(node, rustRuntimeCarrierKey);
  const ast = { kindName: node => node.kind, forEachChild: (node, visit) => node.children.forEach(visit),
    is: { IsExpressionStatement: () => false, IsReturnStatement: () => false,
      IsThrowStatement: node => node.kind === "KindThrowStatement" },
    as: { AsThrowStatement: node => ({ Expression: node.expression }) } };
  return { file, ast, facts, statement };
}

test("component demand reads only exact retained throw operands and carrier facts", () => {
  for (const source of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const { file, ast, facts } = scenario(source);
    const result = rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes);
    assert.deepEqual(result, { thrownCarriers: [source], retained: true });
    assert.equal(Object.isFrozen(result) && Object.isFrozen(result.thrownCarriers), true);
    for (const mutate of [operation => ({ ...operation, error: { ...operation.error, expression: {} } }),
      operation => ({ ...operation, error: { ...operation.error, conversion: {
        ...operation.error.conversion, source: rustSourcePrimitiveTargetType("uint64"),
      } } }),
      operation => ({ ...operation, error: { ...operation.error, conversion: {
        ...operation.error.conversion, route: { kind: "closed", extra: true },
      } } })]) {
      const changed = scenario(source, mutate);
      assert.equal(rustClosedErrorTransportDemand(changed.file, changed.ast, changed.facts, emptyRustTypeDefinitions, projectTypes).thrownCarriers.length, 0);
    }
    const misplaced = scenario(source);
    misplaced.statement.kind = "KindExpressionStatement";
    assert.equal(rustClosedErrorTransportDemand(misplaced.file, misplaced.ast, misplaced.facts, emptyRustTypeDefinitions, projectTypes).thrownCarriers.length, 0);
  }
});

test("closed demand does not accept an immutable-only or unrelated Error projection", () => {
  for (const selectedCarrier of [rustJsErrorTargetType(), rustSourcePrimitiveTargetType("uint64")]) {
    const source = rustTsValueTargetType();
    const { file, ast, facts, statement } = scenario(source);
    statement.kind = "KindExpressionStatement";
    const original = facts.get;
    facts.get = (node, key) => node === statement && key === rustFlowReadProjectionFactKey
      ? { kind: "builtin-error", sourceCarrier: source, selectedCarrier }
      : original(node, key);
    assert.deepEqual(rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes),
      { thrownCarriers: [], retained: false });
  }
});

test("retained narrowed throws retain Error transport without a non-Error payload variant", () => {
  const { file, ast, facts } = scenario(rustRetainedErrorTargetType());
  assert.deepEqual(rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes),
    { thrownCarriers: [], retained: true });
});

test("closed contextual admission has the same component demand and rejects altered source evidence", () => {
  for (const source of [rustTsValueTargetType(), rustJsValueTargetType(), rustRetainedErrorTargetType()]) {
    const { file, ast, facts, statement } = scenario(source);
    statement.kind = "KindExpressionStatement";
    const expression = statement.expression;
    const conversion = selectRustProgramErrorConversion(source);
    const original = facts.get;
    let contextual = { sourceCarrier: source, targetCarrier: conversion.target, conversion };
    facts.get = (node, key) => node === expression && key === rustContextualValueConversionFactKey
      ? contextual : original(node, key);
    facts.getFact = facts.get;
    const result = rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes);
    assert.deepEqual(result, { thrownCarriers: source.id !== rustRetainedErrorTargetType().id ? [source] : [],
      retained: true });
    contextual = { ...contextual, sourceCarrier: rustSourcePrimitiveTargetType("uint64") };
    assert.deepEqual(rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes),
      { thrownCarriers: [], retained: false });
  }
});

test("a closed Error-only projection retains its capability even without a general throw", () => {
  const source = rustJsValueTargetType();
  const { file, ast, facts, statement } = scenario(source);
  statement.kind = "KindExpressionStatement";
  const original = facts.get;
  facts.get = (node, key) => node === statement && key === rustFlowReadProjectionFactKey
    ? { kind: "builtin-error", sourceCarrier: source, selectedCarrier: rustSourceErrorTargetType() }
    : original(node, key);
  assert.deepEqual(rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes),
    { thrownCarriers: [], retained: true });
});

test("closed demand rejects cyclic, missing and over-deep source rows", () => {
  for (const mode of ["cycle", "missing", "depth", "rows"]) {
    const { file, ast, facts } = scenario(rustTsValueTargetType());
    if (mode === "cycle") file.children.push(file);
    if (mode === "missing") file.children.push(undefined);
    if (mode === "depth") {
      let owner = file;
      for (let index = 0; index < 2049; index++) {
        const child = { kind: "KindIdentifier", children: [] };
        owner.children = [child];
        owner = child;
      }
    }
    if (mode === "rows") {
      const original = ast.forEachChild;
      ast.forEachChild = (node, visit) => {
        if (node !== file) return original(node, visit);
        const child = file.children[0];
        for (let index = 0; index < 1_048_577; index++) visit(child);
      };
    }
    assert.equal(rustClosedErrorTransportDemand(file, ast, facts, emptyRustTypeDefinitions, projectTypes) === undefined,
      true, mode);
  }
});
