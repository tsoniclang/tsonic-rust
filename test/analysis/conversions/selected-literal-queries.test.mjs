import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { normalizeSelectedLiteralCarrier } from "../../../dist/analysis/expressions/selected-literals.js";
import { rustPostCheckUnaryMinusOperationId } from "../../../dist/target-model/operations/model.js";

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
  const context = { ast: source.ast, records: tracked.records, requiredRecords: [] };
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
