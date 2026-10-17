import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
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
  const owner = createRustProgramRecordBuilder();
  const records = { ...owner,
    rawLocationPlan: context.records.rawLocationPlan, memoryLayoutObservation: context.records.memoryLayoutObservation,
    rawAddressPlan: context.records.rawAddressPlan, memoryBindingPlan: context.records.memoryBindingPlan,
    typedLocationPlan: context.records.typedLocationPlan, targetOperation: { get(node) {
    operations.set(node, (operations.get(node) ?? 0) + 1);
    return context.records.targetOperation.get(node);
  } }, nativeHandlers: { ...owner.nativeHandlers, selected(node, selected) {
    calls.set(node, (calls.get(node) ?? 0) + 1);
    owner.nativeHandlers.selected(node, selected);
  } } };
  const requirements = [];
  analyzeRustNativeHandlers(nodes, records, { get: context.safetyApplications.operationForExpression }, context.source.sourceFacts, requirements);
  assert.equal(operations.size === nodes.length, true, "every exact checked node is visited");
  assert.equal([...operations.values()].every(count => count === 1), true, "one root-selection input read per node");
  assert.equal(requirements.length === calls.size && calls.size > 0, true, "independent obligations cover every publication");
  assert.equal([...calls.values()].every(count => count === 1), true, "one write per selected subject");
  const kinds = new Set();
  for (const [node] of calls) {
    const selected = records.nativeHandler.get(node);
    const original = context.records.nativeHandler.get(node);
    kinds.add(selected.kind);
    assert.equal(Object.isFrozen(selected), true, "the selected descriptor is frozen");
    assert.equal(records.nativeHandler.get(node) === selected, true, "reads retain identity without reselecting");
    assert.equal(original !== undefined && original.kind === selected.kind, true,
      "the single original pipeline owner selected this same native handler kind");
    if (selected.kind === "native-pointer") {
      const key = selected.selection.kind === "layout-query" ? "observation"
        : selected.selection.kind === "native-pointer" ? "operation" : "plan";
      assert.equal(original.selection.kind === selected.selection.kind && original.selection[key] === selected.selection[key], true,
        "the original pointer selection retains the same admitted payload");
    } else if (selected.kind === "typed-location") {
      assert.equal(original.selection.operation === selected.selection.operation && original.selection.plan === selected.selection.plan, true,
        "the original typed-location selection retains its exact operation and plan");
    } else assert.equal(original.selection === selected.selection, true, "the original source selection retains the same admitted payload");
    if (selected.kind === "memory-binding") assert.equal(selected.selection === records.memoryBindingPlan.get(node), true,
      "memory binding retains its admitted analysis payload");
    if (selected.kind === "typed-location") {
      assert.equal(selected.selection.operation === context.records.targetOperation.get(node), true,
        "typed location retains its admitted operation");
      assert.equal(selected.selection.plan === records.typedLocationPlan.get(node), true,
        "typed location retains its admitted plan");
    }
  }
  assert.equal(isDeepStrictEqual([...kinds].sort(), ["explicit-safety", "memory-binding", "native-pointer", "typed-location"]), true,
    "the complete checked source covers exactly the four native handler kinds");
  const ordinary = nodes.find(node => context.ast.is.IsCallExpression(node) &&
    context.ast.text(context.ast.as.AsCallExpression(node).Expression) === "sizeofShadow");
  assert.equal(ordinary !== undefined && records.nativeHandler.get(ordinary) === undefined &&
    context.records.nativeHandler.get(ordinary) === undefined, true,
    "the checked ordinary source call remains unclaimed");
  const missed = requirements[0];
  const swallowed = createRustProgramRecordBuilder();
  assert.throws(() => swallowed.seal([missed]), error => error.diagnostic?.sourceNode === missed.subject &&
    error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" && /nativeHandler/u.test(error.diagnostic.message),
    "a missing selected handler fails at its exact required source node");
  const published = createRustProgramRecords(owner.seal(requirements));
  assert.equal(published.nativeHandler === records.nativeHandler, true, "publication preserves the exact reader identity");
  assert.equal(operations.size === nodes.length, true, "no root input was recomputed after sealing");
});

test("the JS string root uses the finalized ABI and shadows remain ordinary in actual source", () => {
  const { source: checked, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    import { jsstr as exactJsString } from "@tsonic/js/lang.js";
    import type { JsString } from "@tsonic/js/types.js";
    export function exact(input: string): string { const value: JsString = exactJsString(input); return value.toWellFormed(); }
    function jsstr(value: string): string { return value; }
    export function ordinary(input: string): string { return jsstr(input); }
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
  const call = selections.find(([name]) => name === "exactJsString")[1];
  const shadow = selections.find(([name]) => name === "jsstr")[1];
  const selected = program.records.nativeHandler.get(call);
  assert.equal(selected.kind === "js-string-conversion", true, "the aliased JS-string marker selects its exact handler");
  assert.equal(selected.selection === program.records.targetOperation.get(call), true, "the selected ABI payload retains identity");
  assert.equal(selected.selection.abi.target.path === "js_abi::js_string_from_utf8", true, "the existing native JS-string entry is unchanged");
  assert.equal(program.records.nativeHandler.get(shadow) === undefined, true, "the same-spelled local jsstr remains ordinary");
});
