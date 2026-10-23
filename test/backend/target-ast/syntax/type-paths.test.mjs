import assert from "node:assert/strict";
import test from "node:test";
import { qualifyRustCrateType } from "../../../../dist/backend/target-ast/syntax/type-paths.js";
import { printRustType } from "../../../../dist/print/source/types.js";

test("binary type syntax qualifies the complete selected library carrier without selecting another error", () => {
  const foreign = { kind: "named", path: "foreign_native::Failure", identity: "foreign" };
  const source = { kind: "named", path: "crate::index::NativeErrors2", identity: "selected-lifecycle",
    genericArguments: [{ kind: "type", type: foreign }, { kind: "type", type: {
      kind: "named", path: "crate::errors::Failure", identity: "authored-failure",
    } }] };
  const selected = qualifyRustCrateType(source, "native_program");
  assert.equal(printRustType(selected), "native_program::index::NativeErrors2<foreign_native::Failure, native_program::errors::Failure>",
    "only paths rooted in the selected library crate are qualified");
  assert.equal(selected.identity, source.identity, "the lifecycle join keeps its exact analysis-owned identity");
  assert.equal(selected.genericArguments[1].type.identity, "authored-failure", "the native payload identity is unchanged");
  assert.equal(source.path, "crate::index::NativeErrors2", "the library syntax is not mutated");
  assert.equal(foreign.path, "foreign_native::Failure", "an external native crate is not rerouted through the library");
  for (const path of ["crate", "crate_named::Failure", "Self", "Error0", "core::convert::Infallible", "rt::TsonicError"]) {
    assert.equal(qualifyRustCrateType({ kind: "named", path }, "native_program").path, path,
      `non-library path ${path} is preserved exactly`);
  }
});

test("crate qualification preserves native binders, qualifiers, nested arguments and exact const paths", () => {
  const lifetime = { kind: "named", name: "input" };
  const binder = [{ kind: "lifetime", name: "bound", outlives: [] }];
  const payload = { kind: "named", path: "crate::data::Failure", identity: "failure" };
  const source = { kind: "function-pointer", isUnsafe: true, abi: ["C"], binder,
    parameters: [{ kind: "reference", mutable: true, lifetime, referent: { kind: "fixed-array",
      element: { kind: "raw-pointer", mutable: false, pointee: payload }, length: { kind: "path", path: "crate::sizes::COUNT" } } }],
    result: { kind: "qualified", owner: payload, trait: { kind: "named", path: "crate::traits::FailureLike" }, member: "Result",
      genericArguments: [{ kind: "associated-equality", name: "Error", genericArguments: [], type: payload },
        { kind: "associated-bounds", name: "Output", genericArguments: [{ kind: "const", value: { kind: "path", path: "crate::sizes::COUNT" } }],
          bounds: [{ kind: "trait", path: "crate::traits::Local" }, { kind: "trait-type", reference: { binder, trait: payload } }] }] } };
  const selected = qualifyRustCrateType(source, "native_program");
  assert.equal(selected.binder === binder, true, "higher-ranked lifetime binders are preserved");
  assert.equal(selected.parameters[0].lifetime === lifetime, true, "the original borrow lifetime is retained");
  assert.equal(selected.parameters[0].mutable, true, "exclusive borrowing is not weakened");
  assert.equal(selected.parameters[0].referent.element.pointee.path, "native_program::data::Failure", "nested pointer payload is qualified");
  assert.equal(selected.parameters[0].referent.length.path, "native_program::sizes::COUNT", "const path keeps its exact selected owner");
  assert.equal(selected.result.trait.path, "native_program::traits::FailureLike", "qualified associated output keeps its trait");
  assert.equal(selected.result.genericArguments[0].type.identity, "failure", "associated equality keeps the original payload identity");
  assert.equal(selected.result.genericArguments[1].bounds[0].path, "native_program::traits::Local", "associated bounds are also qualified");
  assert.equal(selected.result.genericArguments[1].bounds[1].reference.binder === binder, true, "trait binders are not reinterpreted");
});
