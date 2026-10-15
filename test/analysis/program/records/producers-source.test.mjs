import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { ForInOrOfStatement_Initializer } from "@tsonic/target-api/source";
import { monomorphicStructuralOptionalFiles } from "../../../../../tsonic/test/fixtures/generic-structural-methods.mjs";

function nodes(source, program, kind) {
  const found = [];
  const visit = node => {
    if (source.ast.kindName(node) === kind) found.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return found;
}

test("source-call publication keeps the exact selected source signature before argument lowering", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    function identity(value: int32): int32 { return value; }
    export function nested(value: int32): int32 { return identity(identity(value)); }
  ` } });
  const calls = nodes(source, program, "KindCallExpression");
  assert.equal(calls.length, 2);
  for (const node of calls) {
    for (const family of ["selectedCall", "targetOperation", "selectedOperation"]) {
      assertRustRecordRequirement(requiredRecords, family, node);
    }
    assert.equal(requiredRecords.some(row => row.family === "retainedCallLifetimes" && row.subject === node), false);
    const signature = program.records.selectedCall.get(node);
    const operation = program.records.targetOperation.get(node);
    assert.equal(signature !== undefined, true);
    assert.equal(operation?.kind, "source-call");
    assert.equal(signature.sourceArgumentBindings?.length, 1);
    assert.equal(operation.parameters.length, 1);
    assert.equal(rustTargetTypeRefEquals(signature.member.returnType, operation.resultCarrier), true);
  }
});

test("for-of publication retains both initializer and exact binding carrier evidence", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export function total(values: int32[]): int32 {
      let sum: int32 = 0;
      for (const value of values) sum += value;
      return sum;
    }
  ` } });
  const statements = nodes(source, program, "KindForOfStatement");
  assert.equal(statements.length, 1);
  const statement = statements[0];
  assertRustRecordRequirement(requiredRecords, "targetOperation", statement);
  const selected = program.records.targetOperation.get(statement);
  assert.equal(selected?.kind, "iteration");
  const initializer = ForInOrOfStatement_Initializer(source.ast, statement);
  assert.equal(initializer !== undefined, true);
  assertRustRecordRequirement(requiredRecords, "runtimeCarrier", initializer);
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(initializer)?.carrier, selected.elementCarrier), true);
  const declarations = nodes(source, program, "KindVariableDeclaration").filter(node =>
    source.ast.text(source.ast.name(node)) === "value");
  assert.equal(declarations.length, 1);
  for (const declaration of declarations) assertRustRecordRequirement(requiredRecords, "runtimeCarrier", declaration);
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(declarations[0])?.carrier, selected.elementCarrier), true);
});

test("optional structural call publication preserves its source guard and exact callable signature", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, files: monomorphicStructuralOptionalFiles });
  const optionalCalls = nodes(source, program, "KindCallExpression").filter(node =>
    program.records.optionalChain.get(node)?.operationKind === "method");
  assert.equal(optionalCalls.length > 0, true);
  for (const call of optionalCalls) {
    const chain = program.records.optionalChain.get(call);
    const signature = program.records.selectedCall.get(call);
    assert.equal(signature !== undefined, true);
    assert.equal(signature.sourceCallableCarrier !== undefined, true);
    assert.equal(program.records.runtimeCarrier.get(chain.guard) !== undefined, true);
  }
});

test("nested direct callee selection publishes its member before invocation storage is consumed", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    interface Handler { run: (value: int32) => int32; }
    export function invoke(handler: Handler, value: int32): int32 { return handler.run(value); }
  ` } });
  const members = nodes(source, program, "KindPropertyAccessExpression");
  const calls = nodes(source, program, "KindCallExpression");
  assert.equal(members.length, 1);
  assert.equal(calls.length, 1);
  for (const family of ["targetOperation", "selectedOperation"]) assertRustRecordRequirement(requiredRecords, family, members[0]);
  for (const family of ["selectedCall", "targetOperation"]) assertRustRecordRequirement(requiredRecords, family, calls[0]);
  const member = program.records.targetOperation.get(members[0]);
  const signature = program.records.selectedCall.get(calls[0]);
  assert.equal(member !== undefined, true);
  assert.equal(signature !== undefined, true);
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(members[0])?.carrier,
    signature.sourceCallableCarrier), true);
  assert.equal(member.operationId, program.records.selectedOperation.get(members[0]).operationId);
});

test("inferred member return probes retain the same operation, carrier and selected call evidence", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
    function width(value: string) { return value.length; }
    export function inspect(value: string) { return width(value); }
  ` } });
  const members = nodes(source, program, "KindPropertyAccessExpression");
  const calls = nodes(source, program, "KindCallExpression");
  assert.equal(members.length, 1);
  assert.equal(calls.length, 1);
  const operation = program.records.targetOperation.get(members[0]);
  const signature = program.records.selectedCall.get(calls[0]);
  assert.equal(operation !== undefined, true);
  assert.equal(signature !== undefined, true);
  assert.equal(operation.operationId, program.records.selectedOperation.get(members[0]).operationId);
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(members[0])?.carrier,
    signature.member.returnType), true);
  assert.equal(signature.member.returnType.name, "native-uint");
});

test("deferred callback finalization publishes exact target, carrier and source signature together", () => {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
    export function doubled(values: number[]): number[] { return values.map(value => value * 2); }
  ` } });
  const calls = nodes(source, program, "KindCallExpression");
  assert.equal(calls.length, 1);
  const call = calls[0];
  for (const family of ["targetOperation", "selectedOperation", "selectedCall"]) assertRustRecordRequirement(requiredRecords, family, call);
  const operation = program.records.targetOperation.get(call);
  const selected = program.records.selectedOperation.get(call);
  const signature = program.records.selectedCall.get(call);
  assert.equal(operation !== undefined, true);
  assert.equal(selected !== undefined, true);
  assert.equal(signature !== undefined, true);
  assert.equal(operation.operationId, selected.operationId);
  assert.equal(signature.sourceSignature === selected.provenance.sourceSelectedSignature, true);
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(call)?.carrier, selected.resultType), true);
});
