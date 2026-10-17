import assert from "node:assert/strict";
import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { nativePropertyProjectionCostSource } from "../../../../../tsonic/test/fixtures/native-property-projections.mjs";

function compile(text) {
  const compiled = compileRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": text } });
  assert.equal(compiled.result.diagnostics.length, 0,
    compiled.result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
  assert.equal(compiled.result.program !== undefined, true);
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    compiled.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  compiled.result.program.sourceFiles.forEach(visit);
  return { ...compiled, program: compiled.result.program, nodes };
}

test("checked native guards publish both Boolean outcomes and the exact unreachable source tail", () => {
  const { source, program, nodes, requiredRecords } = compile(`
    export function inspect(value: string): boolean {
      if (typeof value === "number") return false;
      if (typeof value === "string") return true;
      return false;
    }
  `);
  const guards = nodes.filter(node => program.records.nativeGuardResult.get(node) !== undefined);
  const unreachable = nodes.filter(node => program.records.nativeUnreachable.get(node) === true);
  assert.equal(guards.length, 2);
  assert.equal(unreachable.length, 2);
  assert.equal(program.records.nativeGuardResult.get(guards[0]), false);
  assert.equal(program.records.nativeGuardResult.get(guards[1]), true);
  for (const node of unreachable) assert.equal(source.ast.kindName(node), "KindReturnStatement");
  const declaration = nodes.find(node => source.ast.is.IsFunctionDeclaration(node));
  const statements = source.ast.statements(source.ast.body(declaration));
  const excludedBranch = source.ast.as.AsIfStatement(statements[0]).ThenStatement;
  assertRustRecordRequirement(requiredRecords, "nativeUnreachable", excludedBranch);
  assertRustRecordRequirement(requiredRecords, "nativeUnreachable", statements[2]);
  for (const statement of statements.slice(0, 2)) assertRustRecordRequirement(requiredRecords, "nativeGuardResult", source.ast.as.AsIfStatement(statement).Expression);
  assert.equal(unreachable.includes(excludedBranch), true,
    "the known-false guard retains its actual nonselected then-branch root");
  assert.equal(unreachable.includes(statements[2]), true,
    "the unconditional native string guard returns before the exact source tail");
  assert.equal(program.records.nativeGuardResult.get({}) === undefined, true);
  assert.equal(program.records.nativeUnreachable.get({}) === undefined, true);
});

test("generic comparisons publish their exact checked operand carriers on the actual binary expression", () => {
  const { source, program, nodes, requiredRecords } = compile(`
    export function above<T extends number | bigint>(value: T): boolean { return value > 2n; }
  `);
  const recorded = nodes.filter(node => program.records.genericNumericOperands.get(node) !== undefined);
  const expectedBinary = nodes.find(node => source.ast.is.IsBinaryExpression(node));
  assertRustRecordRequirement(requiredRecords, "genericNumericOperands", expectedBinary);
  assertRustRecordRequirement(requiredRecords, "selectedOperation", expectedBinary);
  assertRustRecordRequirement(requiredRecords, "targetOperation", expectedBinary);
  assert.equal(recorded.length, 1);
  const node = recorded[0];
  const binary = source.ast.as.AsBinaryExpression(node);
  assert.equal(binary !== undefined, true);
  const operands = program.records.genericNumericOperands.get(node);
  assert.equal(Object.isFrozen(operands), true);
  assert.equal(operands.length, 2);
  assert.equal(operands[0].kind, "type-parameter");
  for (const [index, operand] of [binary.Left, binary.Right].entries()) {
    assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(operand)?.carrier, operands[index]), true,
      `operand ${index} retains exact producer-selected storage`);
  }
  assert.equal(program.records.genericNumericOperands.get({}) === undefined, true);
});

test("checked literal, template and computed indexed arguments retain their independent evaluation decisions", () => {
  const { source, program, nodes, requiredRecords } = compile(`
    let calls = 0;
    function selected(): "value" { calls++; return "value"; }
    function get<T, K extends keyof T>(value: T, key: K): T[K] { return value[key]; }
    export function read(): number {
      const value = { value: 3 };
      return get(value, "value") + get(value, \`value\`) + get(value, selected());
    }
  `);
  const recorded = nodes.filter(node => program.records.indexedFieldKeyArgument.get(node) !== undefined);
  const calls = nodes.filter(node => source.ast.is.IsCallExpression(node) && source.ast.text(source.ast.as.AsCallExpression(node).Expression) === "get");
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assertRustRecordRequirement(requiredRecords, "indexedFieldKeyArgument", source.ast.arguments(call)[1]);
    assert.equal(requiredRecords.some(row => row.family === "indexedFieldKeyArgument" && row.subject === call), false);
  }
  assert.equal(recorded.length, 3);
  assert.deepEqual(recorded.map(node => source.ast.kindName(node)),
    ["KindStringLiteral", "KindNoSubstitutionTemplateLiteral", "KindCallExpression"]);
  assert.deepEqual(recorded.map(node => program.records.indexedFieldKeyArgument.get(node).evaluate), [false, false, true]);
  const carrier = program.records.indexedFieldKeyArgument.get(recorded[0]).carrier;
  for (const node of recorded) {
    assert.equal(rustTargetTypeRefEquals(program.records.indexedFieldKeyArgument.get(node).carrier, carrier), true);
  }
  assert.equal(program.records.indexedFieldKeyArgument.get({}) === undefined, true);
});

test("native property projection retains selected field identity without admitting unrelated API members", () => {
  const { source, program, nodes, requiredRecords } = compile(nativePropertyProjectionCostSource);
  const call = nodes.find(node => source.ast.is.IsCallExpression(node) && source.ast.is.IsPropertyAccessExpression(source.ast.as.AsCallExpression(node).Expression) &&
    source.ast.text(source.ast.name(source.ast.as.AsCallExpression(node).Expression)) === "toLocaleString");
  assertRustRecordRequirement(requiredRecords, "propertyProjection", source.ast.arguments(call)[1]);
  const projected = nodes.filter(node => program.records.propertyProjection.get(node) !== undefined);
  assert.equal(projected.length, 1);
  const record = program.records.propertyProjection.get(projected[0]);
  assert.equal(Object.isFrozen(record) && Object.isFrozen(record.cases), true);
  assert.equal(record.cases.length, 1);
  const selected = record.cases[0];
  assert.equal(selected.conversion.kind, "js-value-from-properties");
  assert.equal(selected.conversion.fields.length, 1);
  assert.equal(selected.conversion.fields[0].sourceName, "useGrouping");
  assert.equal(selected.reads.length, 1);
  assert.equal(selected.reads[0].kind, "source-field");
  assert.equal(rustTargetTypeRefEquals(selected.reads[0].resultCarrier, selected.conversion.fields[0].sourceCarrier), true);
  assert.equal(program.records.propertyProjection.get({}) === undefined, true);
});

test("optional projected fields preserve native absence and only the selected member's conversion", () => {
  const { source, program, nodes, requiredRecords } = compile(`
    import type { int64 } from "@tsonic/core/types.js";
    export function format(options: { useGrouping?: boolean }): string {
      const value: int64 = 9007199254740993n;
      return value.toLocaleString("en", options);
    }
  `);
  const projected = nodes.filter(node => program.records.propertyProjection.get(node) !== undefined);
  const call = nodes.find(node => source.ast.is.IsCallExpression(node) && source.ast.is.IsPropertyAccessExpression(source.ast.as.AsCallExpression(node).Expression) &&
    source.ast.text(source.ast.name(source.ast.as.AsCallExpression(node).Expression)) === "toLocaleString");
  assertRustRecordRequirement(requiredRecords, "propertyProjection", source.ast.arguments(call)[1]);
  assert.equal(projected.length, 1);
  const record = program.records.propertyProjection.get(projected[0]);
  assert.equal(record.cases.length, 1);
  assert.equal(record.cases[0].conversion.fields.length, 1);
  assert.equal(record.cases[0].conversion.fields[0].presence, "optional");
  assert.equal(record.cases[0].conversion.fields[0].sourceName, "useGrouping");
  assert.equal(record.cases[0].reads.length, 1);
});
