import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { analyzeSourceLiteralValues, createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { normalizeSelectedLiteralCarrier } from "../../../dist/analysis/expressions/selected-literals.js";
import { rustPostCheckUnaryMinusOperationId } from "../../../dist/target-model/operations/model.js";
import { isRustNumericCarrier, rustPrimitiveTypeName } from "../../../dist/target-model/types/carriers/primitives.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };

function track(builder) {
  const admissions = { runtime: 0, target: 0, selected: 0 };
  const records = { ...builder, runtimeCarriers: { ...builder.runtimeCarriers, source(node, carrier) {
    const absent = builder.runtimeCarrier.get(node) === undefined;
    const conflict = builder.runtimeCarriers.source(node, carrier);
    if (absent && conflict === undefined) admissions.runtime++;
    return conflict;
  } }, targetOperations: { ...builder.targetOperations, source(...arguments_) {
    admissions.target++;
    return builder.targetOperations.source(...arguments_);
  } }, selectedOperations: { ...builder.selectedOperations, operator(...arguments_) {
    admissions.selected++;
    return builder.selectedOperations.operator(...arguments_);
  } } };
  return { records, admissions };
}

function fixture(expression) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project",
    files: { "/project/index.ts": `export const value = ${expression};` },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  let node;
  const visit = current => {
    if (source.ast.is.IsVariableDeclaration(current)) node = source.ast.as.AsVariableDeclaration(current)?.Initializer;
    source.ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  source.sourceFiles.forEach(visit);
  assert.equal(node !== undefined, true);
  const builder = createRustProgramRecordBuilder();
  const tracked = track(builder);
  const context = { ast: source.ast, records: tracked.records, requiredRecords: [],
    literalValues: analyzeSourceLiteralValues(source.ast, source.sourceFiles) };
  const options = { sourceTypes: { enumVariantForLiteral: () => undefined } };
  return { node, builder, context, options, admissions: tracked.admissions,
    select: (actual, expected) => normalizeSelectedLiteralCarrier(node, actual, expected, context, options) };
}

for (const expression of ["3", "-3", "+3"]) {
  test(`checked ${expression} literal queries admit once and retain canonical complete native evidence`, () => {
    const current = fixture(expression);
    const first = current.select(undefined, integer);
    const native = current.builder.targetOperation.get(current.node);
    const selected = current.builder.selectedOperation.get(current.node);
    const counts = expression === "3" ? { runtime: 1, target: 0, selected: 0 } : { runtime: 1, target: 1, selected: 1 };
    assert.deepEqual(current.admissions, counts);
    assert.equal(current.select(first, { ...integer }) === first, true);
    assert.equal(current.builder.targetOperation.get(current.node) === native, true);
    assert.equal(current.builder.selectedOperation.get(current.node) === selected, true);
    assert.deepEqual(current.admissions, counts);
    assert.throws(() => current.select(first, wide), /Conflicting Rust semantic plan/u);
    assert.equal(current.builder.runtimeCarrier.get(current.node)?.carrier === first, true);
    assert.deepEqual(current.admissions, counts);
    current.builder.seal(current.context.requiredRecords);
    assert.throws(() => current.select(first, integer), /after analysis is sealed/u);
  });
}

for (const expression of ["1.5", "-1.5", "+1.5"]) {
  test(`checked ${expression} half literal queries admit once without widening runtime numerics`, () => {
    const current = fixture(expression);
    const half = { kind: "source-primitive", name: "float16" };
    const first = current.select(undefined, half);
    assert.equal(first === half, true, "the exact native literal carrier is selected");
    const native = current.builder.targetOperation.get(current.node);
    const selected = current.builder.selectedOperation.get(current.node);
    const counts = expression === "1.5" ? { runtime: 1, target: 0, selected: 0 } : { runtime: 1, target: 1, selected: 1 };
    assert.deepEqual(current.admissions, counts, "literal evidence is admitted exactly once");
    assert.equal(current.select(first, { ...half }) === first, true, "repeated selection preserves carrier identity");
    assert.equal(current.builder.targetOperation.get(current.node) === native, true, "native literal evidence is stable");
    assert.equal(current.builder.selectedOperation.get(current.node) === selected, true, "selected literal evidence is stable");
    assert.deepEqual(current.admissions, counts, "repeated selection never writes again");
    assert.equal(isRustNumericCarrier(half), false, "literal admission does not enable runtime half operators");
    assert.equal(rustPrimitiveTypeName("float16"), undefined, "literal admission invents no native runtime half renderer");
    current.builder.seal(current.context.requiredRecords);
    assert.throws(() => current.select(first, half), /after analysis is sealed/u);
  });
}

test("half overflow admits no facts and preserves an existing explicit float64 selection", () => {
  const half = { kind: "source-primitive", name: "float16" };
  const invalid = fixture("65520");
  assert.equal(invalid.select(undefined, half), undefined, "half native overflow is not admitted");
  assert.equal(invalid.builder.runtimeCarrier.get(invalid.node) === undefined, true, "no invalid runtime carrier");
  assert.equal(invalid.builder.targetOperation.get(invalid.node) === undefined, true, "no invalid native operation");
  assert.equal(invalid.builder.selectedOperation.get(invalid.node) === undefined, true, "no invalid selected operation");
  assert.deepEqual(invalid.admissions, { runtime: 0, target: 0, selected: 0 }, "no partial literal publication");
  const explicit = fixture("65520");
  const first = explicit.select(undefined, { kind: "source-primitive", name: "float64" });
  assert.equal(explicit.select(first, half) === first, true, "native float64 admission is not retroactively changed");
  assert.equal(explicit.builder.runtimeCarrier.get(explicit.node)?.carrier === first, true, "the original carrier remains canonical");
  assert.deepEqual(explicit.admissions, { runtime: 1, target: 0, selected: 0 }, "invalid half selection never rewrites float64");
});

test("a new unrepresentable literal target does not poison the selected carrier", () => {
  const current = fixture("256");
  const first = current.select(undefined, integer);
  assert.equal(current.select(first, { kind: "source-primitive", name: "uint8" }) === first, true);
  assert.equal(current.builder.runtimeCarrier.get(current.node)?.carrier === first, true);
  assert.deepEqual(current.admissions, { runtime: 1, target: 0, selected: 0 });
});

test("a repeated enum literal validates the native variant, not just its result carrier", () => {
  const current = fixture('"one"');
  let name = "One";
  current.options.sourceTypes.enumVariantForLiteral = () => ({ name });
  const first = current.select(undefined, integer);
  const native = current.builder.targetOperation.get(current.node);
  assert.equal(native.kind, "source-enum-member");
  assert.equal(native.enumRepresentation.kind, "literal-union", "a literal alias is not a numeric source enum");
  assert.equal(Object.hasOwn(native.enumRepresentation, "integerWidth"), false, "no fake numeric width is recorded");
  assert.equal(current.select(first, { ...integer }) === first, true);
  assert.deepEqual(current.admissions, { runtime: 1, target: 1, selected: 0 });
  name = "Other";
  assert.throws(() => current.select(first, integer), /tsonic\.rust\.targetOperation/u);
  assert.equal(current.builder.targetOperation.get(current.node) === native, true);
  assert.equal(current.builder.runtimeCarrier.get(current.node)?.carrier === first, true);
});

test("literal queries keep native operand modes and selected source provenance exact", () => {
  const wrongModes = fixture("-3");
  wrongModes.builder.targetOperations.source(wrongModes.node, { kind: "operator-token",
    operationId: rustPostCheckUnaryMinusOperationId, operator: "-", resultCarrier: integer, operandModes: ["value", "value"] });
  const native = wrongModes.builder.targetOperation.get(wrongModes.node);
  assert.throws(() => wrongModes.select(undefined, integer), /tsonic\.rust\.targetOperation/u);
  assert.equal(wrongModes.builder.targetOperation.get(wrongModes.node) === native, true);
  const wrongSource = fixture("-3");
  wrongSource.builder.targetOperations.unaryMinusLiteral(wrongSource.node, integer);
  wrongSource.builder.selectedOperations.project(wrongSource.node, rustPostCheckUnaryMinusOperationId, "operator", "-", integer);
  const selected = wrongSource.builder.selectedOperation.get(wrongSource.node);
  assert.throws(() => wrongSource.select(undefined, integer), /'selectedOperation'/u);
  assert.equal(wrongSource.builder.selectedOperation.get(wrongSource.node) === selected, true);
});

test("an inherited literal request reads all canonical facts without child admission", () => {
  const current = fixture("-3");
  const first = current.select(undefined, integer);
  const native = current.builder.targetOperation.get(current.node);
  const selected = current.builder.selectedOperation.get(current.node);
  const child = createRustProgramRecordBuilder(undefined, current.builder.seal(current.context.requiredRecords));
  const tracked = track(child);
  current.context.records = tracked.records;
  current.context.requiredRecords = [];
  assert.equal(current.select(first, { ...integer }) === first, true);
  assert.equal(child.targetOperation.get(current.node) === native, true);
  assert.equal(child.selectedOperation.get(current.node) === selected, true);
  assert.deepEqual(tracked.admissions, { runtime: 0, target: 0, selected: 0 });
  child.seal(current.context.requiredRecords);
  assert.throws(() => current.select(first, integer), /after analysis is sealed/u);
});
