import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { analyzeRustNativeHandlers } from "../../../dist/analysis/operations/native-handlers.js";
import { createRustProgramRecordBuilder, createRustProgramRecords } from "../../../dist/analysis/program/records/create.js";
import { memoryAbiCapability } from "../../helpers/memory-abi.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";

const source = `
  import { abi } from "test:abi";
  import { memorylayout, memoryfield, bindmemoryfield, bindmemoryrecord, allocateptr, loadptr,
    torawptr, reinterpretrawptr, sizeof, unsafecontext } from "@tsonic/core/lang.js";
  import type { uint32, nativeUint } from "@tsonic/core/types.js";
  type Cell = { value: uint32 };
  const scalar = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
  const slot = memoryfield({ select: (value: Cell) => value.value, byteoffset: 0, bytealignment: 4, fieldlayout: scalar });
  const layout = memorylayout<Cell>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [slot] });
  export function create(value: uint32): Cell { return bindmemoryrecord(layout, bindmemoryfield(slot, allocateptr(value))); }
  export function read(value: uint32): uint32 {
    unsafecontext(); const pointer = allocateptr(value); const raw = torawptr(pointer, scalar);
    const restored = reinterpretrawptr(raw, scalar);
    return restored === undefined ? 0 : loadptr(restored);
  }
  export function size(): nativeUint { return sizeof(scalar); }
  function sizeofShadow(value: uint32): uint32 { return value; }
  export function ordinary(value: uint32): uint32 { return sizeofShadow(value); }
`;

test("the final native owner visits the actual checked domain once, publishes exact data, and cannot lose a required write", () => {
  const { context } = analyzeRustOperations(source, { surfaces: [], capabilities: [memoryAbiCapability("rust")] });
  const calls = new Map();
  const operations = new Map();
  const nodes = context.sourceStorage.nodes;
  const records = { ...context.records, targetOperation: { get(node) {
    operations.set(node, (operations.get(node) ?? 0) + 1);
    return context.records.targetOperation.get(node);
  } }, nativeHandlers: { ...context.records.nativeHandlers, selected(node, selected) {
    calls.set(node, (calls.get(node) ?? 0) + 1);
    context.records.nativeHandlers.selected(node, selected);
  } } };
  const requirements = [];
  analyzeRustNativeHandlers(nodes, records, { get: context.safetyApplications.operationForExpression }, context.source.sourceFacts, requirements);
  assert.equal(operations.size, nodes.length, "every exact checked node is visited");
  assert.equal([...operations.values()].every(count => count === 1), true, "one root-selection input read per node");
  assert.equal(requirements.length === calls.size && calls.size > 0, true, "independent obligations cover every publication");
  assert.equal([...calls.values()].every(count => count === 1), true, "one write per selected subject");
  const kinds = new Set();
  for (const [node] of calls) {
    const selected = records.nativeHandler.get(node);
    kinds.add(selected.kind);
    assert.equal(Object.isFrozen(selected), true);
    assert.equal(records.nativeHandler.get(node) === selected, true, "reads retain identity without reselecting");
    if (selected.kind === "memory-binding") assert.equal(selected.selection === records.memoryBindingPlan.get(node), true);
    if (selected.kind === "typed-location") {
      assert.equal(selected.selection.operation === context.records.targetOperation.get(node), true);
      assert.equal(selected.selection.plan === records.typedLocationPlan.get(node), true);
    }
  }
  assert.deepEqual([...kinds].sort(), ["explicit-safety", "memory-binding", "native-pointer", "typed-location"]);
  const ordinary = nodes.find(node => context.ast.is.IsCallExpression(node) &&
    context.ast.text(context.ast.as.AsCallExpression(node).Expression) === "sizeofShadow");
  assert.equal(ordinary !== undefined && records.nativeHandler.get(ordinary) === undefined, true);
  const missed = requirements[0];
  const swallowed = createRustProgramRecordBuilder();
  assert.throws(() => swallowed.seal([missed]), error => error.diagnostic?.sourceNode === missed.subject &&
    error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" && /nativeHandler/u.test(error.diagnostic.message));
  const published = createRustProgramRecords(context.records.seal(requirements));
  assert.equal(published.nativeHandler === records.nativeHandler, true);
  assert.equal(operations.size, nodes.length, "no root input was recomputed after sealing");
});

test("the JS string root uses the finalized ABI and shadows remain ordinary in actual source", () => {
  const { source: checked, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    import { jsstr } from "@tsonic/js/lang.js";
    import type { JsString } from "@tsonic/js/types.js";
    export function exact(input: string): string { const value: JsString = jsstr(input); return value.toWellFormed(); }
    function jsstrShadow(value: string): string { return value; }
    export function ordinary(input: string): string { return jsstrShadow(input); }
  ` } });
  const selections = [];
  const visit = node => {
    if (checked.ast.is.IsCallExpression(node)) {
      const callee = checked.ast.as.AsCallExpression(node).Expression;
      const text = String(checked.ast.getSourceText(checked.ast.getSourceFile(node)));
      selections.push([text.slice(checked.ast.pos(callee), checked.ast.end(callee)).trim(), node]);
    }
    checked.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const call = selections.find(([name]) => name === "jsstr")[1];
  const shadow = selections.find(([name]) => name === "jsstrShadow")[1];
  const selected = program.records.nativeHandler.get(call);
  assert.equal(selected.kind, "js-string-conversion");
  assert.equal(selected.selection === program.records.targetOperation.get(call), true);
  assert.equal(selected.selection.abi.target.path, "js_abi::js_string_from_utf8");
  assert.equal(program.records.nativeHandler.get(shadow) === undefined, true);
});
