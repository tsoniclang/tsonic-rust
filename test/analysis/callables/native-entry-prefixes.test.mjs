import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustNativeHelperStatePassing, selectRustNativeFrameOwnerPassing, selectRustNativeStructuralReceiverPassing } from "../../../dist/policy/ownership/generic-callables.js";
import { rustTargetGenericArgumentEquals } from "../../../dist/target-model/types/equality.js";

test("native async entry captures retain authored phantom type identities even without a stored value", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export async function empty<Value>(): Promise<void> {}
` } });
  let declaration;
  const visit = node => {
    if (program.source.ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === "empty") declaration = node;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declaration !== undefined, true, "the original async declaration is retained");
  const selected = program.records.callableLeading.get(declaration);
  const parameter = selected?.genericHeader?.sourceContract.parameters[0];
  assert.equal(parameter?.kind === "type", true, "the exact authored generic contract is finalized before retention");
  const entry = selected.nativeEntry.direct.body;
  assert.equal(entry.slots.length, 0, "the native body has no invented value input or helper state");
  assert.equal(entry.captureArguments.some(argument => argument.kind === "type" && argument.type.kind === "type-parameter" &&
    argument.type.identity === parameter.identity), true,
  "the native async capture inventory retains the phantom type's static-proof obligation");
});

test("fixed native method entries retain canonical shape and selected field facet identity", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function make(value: number): { read(): number } {
  return { read(): number { return value; } };
}
` } });
  let checked = 0;
  for (const shape of program.structuralShapes.definitions) for (const field of shape.fields) {
    if (field.methodPlan?.kind !== "fixed") continue;
    const leading = program.records.callableLeading.get(field.methodPlan.declaration);
    const entries = leading?.nativeEntry.structuralFixed;
    const fields = entries?.get(shape);
    const selected = fields?.get(field.sourceName);
    assert.equal(selected !== undefined, true, "the actual canonical shape and selected field own their entry facets");
    assert.equal(entries.get({ ...shape }) === undefined, true, "a foreign same-shaped owner cannot select this field's entry");
    assert.equal(entries.set === undefined && fields.set === undefined && Object.isFrozen(selected), true,
      "the complete context-indexed publication exposes no mutation route");
    for (const facet of ["body", "object"]) {
      const receiver = selected[facet].slots[0];
      assert.equal(receiver.kind === "structural-receiver" && receiver.owner === shape && receiver.sourceName === field.sourceName &&
        receiver.carrier === shape.carrier, true, "the selected receiver retains exact canonical owner, field and carrier identities");
      assert.equal(receiver.passing, facet === "body" ? "shared" : field.methodPlan.factoryReceiver,
        "native body and object adapter retain their independently selected receiver ABI");
      assert.equal(selected[facet].slots.some(slot => slot.kind === "leading" && slot.parameter.kind === "this"), false,
        "the selected structural receiver replaces this rather than adding a duplicate input");
      assert.equal(shape.genericArguments.every(argument => selected[facet].captureArguments.some(selected =>
        rustTargetGenericArgumentEquals(selected, argument))), true,
      "all owner-bound generic arguments remain capture obligations even when not introduced as method binders");
    }
    checked++;
  }
  assert.equal(checked > 0, true, "the real captured structural method exercises a fixed native entry");
});

test("native helper prefix policy preserves every physical state and frame passing mode", () => {
  for (const mode of ["value", "shared"]) {
    const selected = selectRustNativeStructuralReceiverPassing(mode);
    assert.equal(selected.body === "shared" && selected.object === mode, true,
      "structural body borrowing and object factory ownership remain independent native facets");
  }
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
