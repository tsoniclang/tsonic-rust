import assert from "node:assert/strict";
import test from "node:test";
import { qualifyRustReferencePath, qualifyRustReferenceType } from "../../../../dist/backend/target-ast/syntax/type-paths.js";
import { printRustType } from "../../../../dist/print/source/types.js";

test("binary type syntax qualifies the complete selected library carrier without selecting another error", () => {
  const foreign = { kind: "named", path: "foreign_native::Failure", identity: "foreign" };
  const source = { kind: "named", path: "crate::index::NativeErrors2", identity: "selected-lifecycle",
    genericArguments: [{ kind: "type", type: foreign }, { kind: "type", type: {
      kind: "named", path: "crate::errors::Failure", identity: "authored-failure",
    } }] };
  const selected = qualifyRustReferenceType(source, new Map([["crate", "native_program"]]));
  assert.equal(printRustType(selected), "native_program::index::NativeErrors2<foreign_native::Failure, native_program::errors::Failure>",
    "only paths rooted in the selected library crate are qualified");
  assert.equal(selected.identity, source.identity, "the lifecycle join keeps its exact analysis-owned identity");
  assert.equal(selected.genericArguments[1].type.identity, "authored-failure", "the native payload identity is unchanged");
  assert.equal(source.path, "crate::index::NativeErrors2", "the library syntax is not mutated");
  assert.equal(foreign.path, "foreign_native::Failure", "an external native crate is not rerouted through the library");
  for (const path of ["crate", "crate_named::Failure", "Self", "Error0", "core::convert::Infallible", "rt::TsonicError"]) {
    assert.equal(qualifyRustReferenceType({ kind: "named", path }, new Map([["crate", "native_program"]])).path, path,
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
  const selected = qualifyRustReferenceType(source, new Map([["crate", "native_program"]]));
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

test("native reference qualification resolves declared alias roots in every nested position", () => {
  const references = new Map([["crate", "selected_library"], ["rt", "selected_library::program_errors"],
    ["js_abi", "tsonic_rust_js::abi"]]);
  const source = { kind: "named", path: "crate::StartupErrors", identity: "startup",
    genericArguments: [{ kind: "type", type: { kind: "named", path: "rt::TsonicError", identity: "selected-project-error" } },
      { kind: "type", type: { kind: "qualified", owner: { kind: "named", path: "crate::Worker" },
        trait: { kind: "named", path: "external_alias::Worker" }, member: "Error", genericArguments: [{ kind: "type",
          type: { kind: "named", path: "js_abi::JsValue" } }] } }] };
  const result = qualifyRustReferenceType(source, references);
  assert.equal(printRustType(result),
    "selected_library::StartupErrors<selected_library::program_errors::TsonicError, <selected_library::Worker as external_alias::Worker>::Error<tsonic_rust_js::abi::JsValue>>",
    "the entire selected carrier uses its actual declared destination bindings");
  assert.equal(result.identity, "startup", "the native join identity is unchanged");
  assert.equal(result.genericArguments[0].type.identity, "selected-project-error", "a project error is not replaced by a runtime error");
  assert.equal(source.genericArguments[0].type.path, "rt::TsonicError", "the original library carrier is immutable");
  for (const path of ["rt", "rt_extra::TsonicError", "external_alias::rt::Payload", "::rt::Payload", "Self", "Error0"]) {
    assert.equal(qualifyRustReferencePath(path, references), path, `unbound or non-root path ${path} stays unchanged`);
  }
  assert.equal(qualifyRustReferencePath("rt::TsonicError", new Map()), "rt::TsonicError",
    "an undeclared root is never guessed from its spelling");
});

test("native reference qualification preserves consts, trait objects, opaque captures and intrinsic types", () => {
  const references = new Map([["rt", "tsonic_rust_runtime"], ["crate", "selected_library"]]);
  const source = { kind: "impl-trait", outlives: [], bounds: [{ kind: "trait-type", reference: {
    trait: { kind: "trait-object", principal: { trait: { kind: "named", path: "rt::NativeTrait" } },
      autoTraits: [{ trait: { kind: "named", path: "external_alias::ThreadSafe" } }] } } },
    { kind: "lifetime", lifetime: { kind: "static" } }, { kind: "maybe-sized" }],
    captures: [{ kind: "const", value: { kind: "path", path: "crate::COUNT" } },
      { kind: "lifetime", lifetime: { kind: "named", name: "rt" } }] };
  const result = qualifyRustReferenceType(source, references);
  assert.equal(result.bounds[0].reference.trait.principal.trait.path, "tsonic_rust_runtime::NativeTrait", "native trait owner is resolved");
  assert.equal(result.bounds[0].reference.trait.autoTraits[0].trait.path, "external_alias::ThreadSafe", "foreign native alias is retained");
  assert.equal(result.captures[0].value.path, "selected_library::COUNT", "const capture follows the same native scope rule");
  assert.equal(result.captures[1] === source.captures[1], true, "named lifetime is not a module alias");
  for (const type of [{ kind: "infer" }, { kind: "primitive", name: "i32" }, { kind: "unit" }, { kind: "never" },
    { kind: "string" }, { kind: "str" }]) {
    assert.equal(qualifyRustReferenceType(type, references) === type, true, `${type.kind}: intrinsic type identity retained`);
  }
});
