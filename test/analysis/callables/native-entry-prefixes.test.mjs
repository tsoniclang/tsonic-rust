import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustNativeHelperStatePassing, selectRustNativeFrameOwnerPassing } from "../../../dist/policy/ownership/generic-callables.js";

test("native helper prefix policy preserves every physical state and frame passing mode", () => {
  for (const suspended of [false, true]) for (const storage of ["value", "shared"]) {
    assert.equal(selectRustNativeHelperStatePassing({ suspended, storage, hasPayload: false }), undefined,
      "a marker-only environment has no fabricated physical state input");
    assert.equal(selectRustNativeHelperStatePassing({ suspended, storage, hasPayload: true }),
      !suspended ? "shared-reference" : storage === "value" ? "value" : "rc",
      "the selected state retains its actual suspension and ownership mode");
    assert.equal(selectRustNativeFrameOwnerPassing(suspended), suspended ? "rc" : "shared-reference-to-rc",
      "the live frame owner keeps the original outer Rc even when the owner itself has a handle");
  }
});

test("native frame helper entries retain exact early owner environment and immutable implementation keys", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped(): (count: number) => number {
  const value = new Value();
  const before = value.recurse;
  value.rebind();
  return before;
}
` } });
  let checked = 0;
  for (const definition of program.callableValues.frames.definitions) for (const entry of definition.entries) {
    for (const implementation of entry.implementations) {
      if (implementation.independent) continue;
      const entries = program.records.callableLeading.get(implementation.declaration)?.frameEntries;
      const selected = entries?.get(implementation);
      assert.equal(selected?.implementation === implementation && selected.type.definition === definition && selected.type.entry === entry,
        true, "the helper keeps the exact admitted implementation, frame owner and entry identities");
      assert.equal(Object.isFrozen(entries) && entries.set === undefined && entries.clear === undefined, true,
        "the sealed implementation lookup exposes no mutable Map");
      assert.equal(entries.get({ ...implementation }) === undefined, true, "a foreign implementation cannot select an entry by declaration shape");
      const published = program.records.frameType.get(implementation.carrier);
      assert.equal(published !== undefined && published.environment === selected.type.environment && published.owner === selected.type.owner,
        true, "late error completion reuses the identical early environment and owner without reselection");
      assert.equal(selected.arguments.length === definition.environmentParameters.length && selected.arguments.every((argument, index) =>
        argument.kind === "type" && argument.type === selected.type.environment[index]), true,
      "the helper arguments preserve the complete original ordered environment inventory");
      assert.equal(selected.suspended, false, "the original recursive callbacks are synchronous");
      assert.equal(selected.ownerPassing, "shared-reference-to-rc", "the helper borrows its actual live Rc owner");
      const captures = implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length;
      assert.equal(selected.statePassing, captures === 0 ? undefined : "shared-reference",
        "only actual physical captures introduce a borrowed state parameter");
      checked++;
    }
  }
  assert.equal(checked > 0, true, "the original rebound recursive callable exercises a real native frame helper");
});
