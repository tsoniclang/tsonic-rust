import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

function selectedNodes(source, program) {
  const rows = [];
  const visit = node => {
    const selected = program.records.selectedOperation.get(node);
    if (selected !== undefined) rows.push({ node, selected, kind: source.ast.kindName(node) });
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return rows;
}

test("a nested callable callee retains its selected member before its invocation resolves", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    interface Handler { run: (value: int32) => int32; }
    export function invoke(handler: Handler, value: int32): int32 { return handler.run(value); }
  ` } });
  const rows = selectedNodes(source, program);
  const member = rows.find(row => row.kind === "KindPropertyAccessExpression");
  const call = rows.find(row => row.kind === "KindCallExpression");
  assert.equal(member !== undefined, true, "selected callee");
  assert.equal(call !== undefined, true, "selected invocation");
  assert.equal(member.selected.operationKind, "property");
  assert.equal(member.selected.resultType.id, "rust.runtime.Callable");
  assert.equal(call.selected.operationKind, "method");
  assert.equal(call.selected.targetOperation, "callable");
  assert.equal(call.selected.resultType.name, "int32");
  assert.equal(program.records.selectedOperation.get(member.node) === member.selected, true);
});

test("return probes preserve the native member carrier without changing parent subjects", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    function width(value: string) { return value.length; }
    export function inspect(value: string) { return width(value); }
  ` } });
  const rows = selectedNodes(source, program);
  assert.equal(rows.length, 2);
  const member = rows.find(row => row.kind === "KindPropertyAccessExpression");
  const call = rows.find(row => row.kind === "KindCallExpression");
  assert.equal(member !== undefined, true, "selected returned member");
  assert.equal(call !== undefined, true, "selected inferred call");
  assert.equal(member.selected.resultType.name, "native-uint");
  assert.equal(rustTargetTypeRefEquals(member.selected.resultType, call.selected.resultType), true);
  assert.equal(member.selected.provenance.sourceExpression === member.node, true);
  assert.equal(program.records.selectedOperation.get({}) === undefined, true, "foreign probe subject");
});

test("deferred map finalization publishes its selected native result and exact source signature", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function doubled(values: number[]): number[] { return values.map(value => value * 2); }
  ` } });
  const rows = selectedNodes(source, program);
  const call = rows.find(row => row.kind === "KindCallExpression");
  const arithmetic = rows.find(row => row.kind === "KindBinaryExpression");
  assert.equal(call !== undefined, true, "finalized callback call");
  assert.equal(arithmetic !== undefined, true, "finalized callback body");
  assert.equal(call.selected.targetOperation, "map");
  assert.equal(call.selected.resultType.id, "rust.js.JsArray");
  assert.equal(call.selected.provenance.sourceExpression === call.node, true);
  assert.equal(call.selected.provenance.sourceSelectedSignature ===
    program.records.selectedCall.get(call.node).sourceSignature, true, "exact selected source signature");
  assert.equal(arithmetic.selected.resultType.name, "float64");
});

test("closed array predicates return their selected operation to the canonical owner", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function check(value: unknown): boolean { return Array.isArray(value); }
  ` } });
  const rows = selectedNodes(source, program);
  assert.equal(rows.length, 1);
  const { node, selected } = rows[0];
  assert.equal(selected.operationKind, "method");
  assert.equal(selected.targetOperation, "closed-type-test");
  assert.equal(selected.resultType.name, "bool");
  assert.equal(selected.provenance.sourceExpression === node, true);
});

test("native default initialization publishes exact target data returned by its marker helper", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { defaultvalue } from "@tsonic/core/lang.js";
    export function zero(): int32 { return defaultvalue<int32>(); }
  ` } });
  const rows = selectedNodes(source, program);
  assert.equal(rows.length, 1);
  const { node, selected } = rows[0];
  assert.equal(selected.operationKind, "method");
  assert.equal(selected.targetOperation, "Default::default");
  assert.equal(selected.resultType.name, "int32");
  assert.equal(selected.provenance.sourceExpression === node, true);
  assert.equal(selected.provenance.sourceSelectedSignature ===
    program.records.selectedCall.get(node).sourceSignature, true);
});

test("typed pointer helpers return exact load and store records without owning a writer", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
    import { loadptr, storeptr } from "@tsonic/core/lang.js";
    import type { int32, Pointer } from "@tsonic/core/types.js";
    export function read(pointer: Pointer<int32>): int32 { storeptr(pointer, 3); return loadptr(pointer); }
  ` } });
  const rows = selectedNodes(source, program);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.selected.targetOperation).sort(), ["load", "store"]);
  for (const { node, selected } of rows) {
    assert.equal(selected.operationKind, "method");
    assert.equal(selected.provenance.sourceExpression === node, true);
    assert.equal(selected.provenance.sourceSelectedSignature ===
      program.records.selectedCall.get(node).sourceSignature, true);
    const target = program.records.targetOperation.get(node);
    assert.equal(target?.kind, "typed-location");
    assert.equal(target.operationId, selected.operationId);
    assert.equal(rustTargetTypeRefEquals(target.resultCarrier, selected.resultType), true);
  }
});
