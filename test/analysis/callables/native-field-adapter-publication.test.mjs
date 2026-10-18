import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { completeRustNativeCallableStorageAdapter } from "../../../dist/analysis/callables/native-storage-adapters.js";

const sources = [
  ["declared", `
    interface Wide { read: (value: number) => number; }
    class Item { read = (): number => 7; }
    export function value(): number { const view: Wide = new Item(); return view.read(1); }
  `],
  ["frame", `
    interface Wide { read: (count: number, ignored: number) => number; }
    class Item {
      read = (count: number): number => count === 0 ? 7 : this.read(count - 1);
    }
    export function value(): number { const view: Wide = new Item(); return view.read(2, 1); }
  `],
];

for (const [kind, source] of sources) test(`${kind} field adapters retain the actual selected slot in their original helper context`, () => {
  const compiled = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": source } }).result;
  assert.equal(compiled.diagnostics.length, 0,
    compiled.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
  const program = compiled.program;
  const contexts = program.physicalEmissionContexts.contexts;
  if (kind === "frame") assert.equal(program.callableValues.frames.definitions.some(frame => frame.entries.length > 0), true,
    "the recursive field source produces an actual frame entry for the native ABI assertions");
  for (const frame of program.callableValues.frames.definitions) {
    const context = program.physicalEmissionContexts.contextForOwner(frame, "frame");
    assert.equal(context !== undefined, true, `${kind}: the original complete frame has one final context`);
    assert.equal(context.frameEntries.length, frame.entries.length, `${kind}: every original entry publishes its native ABI`);
    const component = program.sourceOutputIdentities.get(frame.ownerFileName).componentId;
    const boundary = program.errorTransport.componentBoundaryFor(component, component);
    assert.equal(boundary !== undefined, true, `${kind}: the actual defining package owns frame errors`);
    for (const entry of frame.entries) {
      const signatures = context.frameEntries.filter(row => row.entry === entry);
      assert.equal(signatures.length, 1, `${kind}: original entry identity selects exactly one ABI`);
      assert.equal(rustNamedTypeCarrierValue(signatures[0].error)?.nativeErrorIdentity, boundary.errorTypeIdentity,
        `${kind}: frame errors retain the exact defining package, not the caller's runtime alias`);
      assert.equal(Object.isFrozen(signatures[0]) && Object.isFrozen(signatures[0].parameters), true,
        `${kind}: final entry ABI is immutable data`);
      assert.equal(context.frameEntries.some(row => row.entry === { ...entry }), false,
        `${kind}: a copied source entry is not the identical admitted frame member`);
    }
  }
  let checked = 0;
  for (const context of contexts) for (const adapter of context.callableAdapters) {
    if (adapter.origin.kind !== "field") continue;
    const fields = context.nativeBindings.filter(binding => binding.declaration === adapter.origin.selection.declaration &&
      binding.owner.kind === "field");
    assert.equal(fields.length, 1, `${kind}: one exact original slot is published with this helper`);
    const field = fields[0];
    assert.equal(field.contextUse === context.use, true, `${kind}: original helper use identity is retained`);
    assert.equal(adapter.origin.selection.storageIndex, field.owner.storageIndex, `${kind}: storage index is unchanged`);
    assert.equal(Object.isFrozen(field) && Object.isFrozen(field.storage), true, `${kind}: native field evidence is immutable`);
    if (kind === "frame") assert.equal(rustTargetTypeRefEquals(adapter.sourceCarrier, field.storage.payloadCarrier), false,
      "the frame read root is not relabelled as its stored entry payload");
    const preparation = Object.freeze({ ...adapter, source: Object.freeze({ kind: "selected",
      carrier: adapter.sourceCarrier, input: adapter.sourceInput }) });
    const completed = completeRustNativeCallableStorageAdapter(preparation, [], context.use);
    assert.equal(completed.kind, "resolved", `${kind}: already selected source completion is data-only`);
    assert.equal(completed.value.sourceCarrier === adapter.sourceCarrier && completed.value.conversion === adapter.conversion, true,
      `${kind}: no signature or conversion is reselected during publication`);
    assert.equal(program.physicalEmissionContexts.contextFor({ ...context.use }) === undefined, true,
      `${kind}: an equal-shaped foreign use never recovers this helper environment`);
    checked += 1;
  }
  assert.equal(checked > 0, true, `${kind}: the actual source produces a field adaptation, not merely a type alias`);
});
