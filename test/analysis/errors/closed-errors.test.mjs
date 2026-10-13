import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustClosedErrorTransportDemand } from "../../../dist/analysis/errors/closed-errors.js";





import { selectRustProgramErrorConversion } from "../../../dist/target-model/conversions/program-error.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustJsErrorTargetType, rustJsValueTargetType, rustTsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustRetainedErrorTargetType, rustSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";

const projectTypes = { sourceErrorDefinitions: [], sourceCreatedErrorOrigins: [],
  definitionForCarrier: () => undefined, sourceErrorCarrier: rustSourceErrorTargetType };

test("native admission seals the existing native closed payload family", () => {
  const { file, ast, records } = scenario(rustSourcePrimitiveTargetType("uint64"));
  assert.deepEqual(rustClosedErrorTransportDemand(file, ast, records, emptyRustTypeDefinitions, projectTypes),
    { thrownCarriers: [rustTsValueTargetType()], retained: true, sourceView: false });
});

test("typed admission seals the selected profile's exact closed payload carrier", () => {
  for (const carrier of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const definitions = { ...emptyRustTypeDefinitions, closedValueCarrier: carrier };
    const { file, ast, records } = scenario(rustSourcePrimitiveTargetType("uint64"), operation => operation, definitions);
    assert.deepEqual(rustClosedErrorTransportDemand(file, ast, records, definitions, projectTypes),
      { thrownCarriers: [carrier], retained: true, sourceView: false });
  }
});

function scenario(source, mutate = operation => operation, definitions = emptyRustTypeDefinitions) {
  const expression = { kind: "KindIdentifier", children: [] };
  const statement = { kind: "KindThrowStatement", expression, children: [expression] };
  const file = { kind: "KindSourceFile", children: [statement] };
  const operation = mutate({ kind: "throw-op", operationId: "tsonic.rust.error.throw",
    error: { kind: "conversion", expression, conversion: selectRustProgramErrorConversion(source, undefined, definitions) } });
  const records = createRustRecordFixture({
    targetOperation: { get: node => node === statement ? operation : undefined },
    runtimeCarrier: { get: node => node === expression ? { carrier: source } : undefined },
  });
  const ast = { kindName: node => node.kind, forEachChild: (node, visit) => node.children.forEach(visit),
    is: { IsExpressionStatement: () => false, IsReturnStatement: () => false,
      IsThrowStatement: node => node.kind === "KindThrowStatement" },
    as: { AsThrowStatement: node => ({ Expression: node.expression }) } };
  return { file, ast, records, statement };
}

test("component demand reads only exact retained throw operands and carrier facts", () => {
  for (const source of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const { file, ast, records } = scenario(source);
    const result = rustClosedErrorTransportDemand(file, ast, records, emptyRustTypeDefinitions, projectTypes);
    assert.deepEqual(result, { thrownCarriers: [source], retained: true, sourceView: false });
    assert.equal(Object.isFrozen(result) && Object.isFrozen(result.thrownCarriers), true);
    for (const mutate of [operation => ({ ...operation, error: { ...operation.error, expression: {} } }),
      operation => ({ ...operation, error: { ...operation.error, conversion: {
        ...operation.error.conversion, source: rustSourcePrimitiveTargetType("uint64"),
      } } }),
      operation => ({ ...operation, error: { ...operation.error, conversion: {
        ...operation.error.conversion, route: { kind: "closed", extra: true },
      } } })]) {
      const changed = scenario(source, mutate);
      assert.equal(rustClosedErrorTransportDemand(changed.file, changed.ast, changed.records, emptyRustTypeDefinitions, projectTypes).thrownCarriers.length, 0);
    }
    const misplaced = scenario(source);
    misplaced.statement.kind = "KindExpressionStatement";
    assert.equal(rustClosedErrorTransportDemand(misplaced.file, misplaced.ast, misplaced.records, emptyRustTypeDefinitions, projectTypes).thrownCarriers.length, 0);
  }
});

test("closed demand does not accept an immutable-only or unrelated Error projection", () => {
  for (const selectedCarrier of [rustJsErrorTargetType(), rustSourcePrimitiveTargetType("uint64")]) {
    const source = rustTsValueTargetType();
    const { file, ast, records, statement } = scenario(source);
    statement.kind = "KindExpressionStatement";
    const selected = { ...records, flowReadProjection: {
      get: node => node === statement ? { kind: "builtin-error", sourceCarrier: source, selectedCarrier }
        : records.flowReadProjection.get(node),
    } };
    assert.deepEqual(rustClosedErrorTransportDemand(file, ast, selected, emptyRustTypeDefinitions, projectTypes),
      { thrownCarriers: [], retained: false, sourceView: false });
  }
});

test("retained narrowed throws retain Error transport without a non-Error payload variant", () => {
  const { file, ast, records } = scenario(rustRetainedErrorTargetType());
  assert.deepEqual(rustClosedErrorTransportDemand(file, ast, records, emptyRustTypeDefinitions, projectTypes),
    { thrownCarriers: [], retained: true, sourceView: false });
});

test("closed contextual admission has the same component demand and rejects altered source evidence", () => {
  for (const source of [rustTsValueTargetType(), rustJsValueTargetType(), rustRetainedErrorTargetType()]) {
    const { file, ast, records, statement } = scenario(source);
    statement.kind = "KindExpressionStatement";
    const expression = statement.expression;
    const conversion = selectRustProgramErrorConversion(source);
    const original = records.contextualValueConversion.get;
    let contextual = { sourceCarrier: source, targetCarrier: conversion.target, conversion };
    const contextualRecords = { ...records, contextualValueConversion: {
      get: node => node === expression ? contextual : original(node),
    } };
    const result = rustClosedErrorTransportDemand(file, ast, contextualRecords, emptyRustTypeDefinitions, projectTypes);
    assert.deepEqual(result, { thrownCarriers: source.id !== rustRetainedErrorTargetType().id ? [source] : [],
      retained: true, sourceView: false });
    contextual = { ...contextual, sourceCarrier: rustSourcePrimitiveTargetType("uint64") };
    assert.deepEqual(rustClosedErrorTransportDemand(file, ast, contextualRecords, emptyRustTypeDefinitions, projectTypes),
      { thrownCarriers: [], retained: false, sourceView: false });
  }
});

test("a closed Error-only projection retains its capability even without a general throw", () => {
  const source = rustJsValueTargetType();
  const { file, ast, records, statement } = scenario(source);
  statement.kind = "KindExpressionStatement";
  const selected = { ...records, flowReadProjection: {
    get: node => node === statement ? { kind: "builtin-error", sourceCarrier: source, selectedCarrier: rustSourceErrorTargetType() }
      : records.flowReadProjection.get(node),
  } };
  assert.deepEqual(rustClosedErrorTransportDemand(file, ast, selected, emptyRustTypeDefinitions, projectTypes),
    { thrownCarriers: [], retained: true, sourceView: true });
});

test("native Error views in storage, parameter and return carriers demand declarations without retained payloads", () => {
  for (const [key, property] of [["runtimeCarrier", "carrier"],
    ["sourceCallableReturn", "returnCarrier"], ["sourceParameterAbi", "parameterCarrier"]]) {
    for (const carrier of [rustSourceErrorTargetType(),
      { kind: "tuple", elements: [{ kind: "reference", mutable: false, referent: rustSourceErrorTargetType() }] },
      { kind: "closure", args: [rustSourceErrorTargetType()], result: rustJsErrorTargetType() }]) {
      const { file, ast, records, statement } = scenario(rustJsErrorTargetType());
      statement.kind = "KindExpressionStatement";
      const selected = { ...records, [key]: {
        get: node => node === statement ? { [property]: carrier } : records[key].get(node),
      } };
      assert.deepEqual(rustClosedErrorTransportDemand(file, ast, selected, emptyRustTypeDefinitions, projectTypes),
        { thrownCarriers: [], retained: false, sourceView: true });
    }
  }
});

test("native Error-view demand rejects invalid projections and bounds carrier graph traversal", () => {
  const invalid = scenario(rustJsErrorTargetType());
  invalid.statement.kind = "KindExpressionStatement";
  const original = invalid.records.flowReadProjection.get;
  invalid.records = { ...invalid.records, flowReadProjection: {
    get: node => node === invalid.statement
      ? { kind: "builtin-error", sourceCarrier: rustSourcePrimitiveTargetType("uint64"), selectedCarrier: rustSourceErrorTargetType() }
      : original(node),
  } };
  assert.deepEqual(rustClosedErrorTransportDemand(invalid.file, invalid.ast, invalid.records, emptyRustTypeDefinitions, projectTypes),
    { thrownCarriers: [], retained: false, sourceView: false });
  for (const mode of ["depth", "rows", "recursive"]) {
    const fixture = scenario(rustJsErrorTargetType());
    fixture.statement.kind = "KindExpressionStatement";
    let carrier = rustSourceErrorTargetType();
    if (mode === "depth") {
      for (let index = 0; index < 2049; index++) carrier = { kind: "array", element: carrier };
    } else if (mode === "rows") {
      carrier = { kind: "tuple", elements: new Array(1_048_577).fill(carrier) };
    } else {
      carrier = { kind: "tuple", elements: [carrier] };
      carrier.elements.push(carrier);
    }
    const get = fixture.records.runtimeCarrier.get;
    fixture.records = { ...fixture.records, runtimeCarrier: {
      get: node => node === fixture.statement ? { carrier } : get(node),
    } };
    const result = rustClosedErrorTransportDemand(fixture.file, fixture.ast, fixture.records, emptyRustTypeDefinitions, projectTypes);
    if (mode === "recursive") assert.deepEqual(result, { thrownCarriers: [], retained: false, sourceView: true });
    else assert.equal(result === undefined, true, mode);
  }
});

test("closed demand rejects cyclic, missing and over-deep source rows", () => {
  for (const mode of ["cycle", "missing", "depth", "rows"]) {
    const { file, ast, records } = scenario(rustTsValueTargetType());
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
    assert.equal(rustClosedErrorTransportDemand(file, ast, records, emptyRustTypeDefinitions, projectTypes) === undefined,
      true, mode);
  }
});
