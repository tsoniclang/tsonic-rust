import assert from "node:assert/strict";
import test from "node:test";
import { nameRustSignatureTypes } from "../../../dist/backend/target-ast/normalization/signature-aliases.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native opaque output aliases preserve higher-ranked lifetime and type binders", { timeout: 300_000 }, () => {
  const named = (path, genericArguments = []) => ({ kind: "named", path, genericArguments });
  const argument = type => ({ kind: "type", type });
  const lifetime = { kind: "lifetime", lifetime: { kind: "named", name: "scope" } };
  const nested = ["Vec", "Option", "Vec", "Option", "Vec"].reduce(
    (value, path) => named(path, [argument(value)]), named("Item"));
  const payload = named("Payload", [lifetime, argument(nested)]);
  const method = { kind: "function", name: "read", visibility: "public",
    generics: { parameters: [{ kind: "type", name: "Item", bounds: [] }], wherePredicates: [] }, params: [],
    returnType: { kind: "impl-trait", outlives: [], bounds: [{ kind: "trait-type", reference: {
      binder: [{ kind: "lifetime", name: "scope", outlives: [] }], trait: named("Family", [lifetime,
        { kind: "associated-equality", name: "Output", genericArguments: [], type: payload }]),
    } }] },
    body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Identity",
      genericArguments: [argument(named("Item"))], args: [{ kind: "path", path: "std::marker::PhantomData" }] } }] },
  };
  const normalized = nameRustSignatureTypes([method]);
  assert.equal(normalized.aliases.length, 1);
  assert.deepEqual(normalized.aliases[0].generics.parameters.map(parameter => parameter.kind), ["lifetime", "type"]);
  const source = `
pub struct Payload<'scope, Item>(pub &'scope str, pub Item);
pub trait Family<'scope> { type Output; }
pub struct Identity<Item>(std::marker::PhantomData<Item>);
impl<'scope, Item> Family<'scope> for Identity<Item> {
    type Output = Payload<'scope, Vec<Option<Vec<Option<Vec<Item>>>>>>;
}
${[...normalized.aliases, ...normalized.items].map(printRustItem).join("\n")}
#[test]
fn opaque_identity_retains_its_exact_implementation() { let _value = read::<i32>(); }
`;
  const directory = writeGeneratedProject("native_signature_aliases", [
    { path: "Cargo.toml", text: '[package]\nname = "native_signature_aliases"\nversion = "0.1.0"\nedition = "2024"\n' },
    { path: "src/lib.rs", text: source },
  ]);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["fmt", "--all", "--check"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline"]);
});

test("native trait aliases preserve exact associated output projections", { timeout: 300_000 }, () => {
  const named = (path, types = []) => ({ kind: "named", path,
    genericArguments: types.map(type => ({ kind: "type", type })) });
  const projection = { kind: "qualified", owner: named("Self"), member: "Output" };
  const nested = ["Vec", "Option", "Vec", "Option", "Vec"].reduce(
    (value, path) => named(path, [value]), projection);
  const normalized = nameRustSignatureTypes([{ kind: "trait", name: "Family", visibility: "public",
    generics: { parameters: [], wherePredicates: [] }, members: [
      { kind: "type", name: "Output", generics: { parameters: [], wherePredicates: [] }, bounds: [] },
      { kind: "function", name: "read", selfParam: { kind: "reference", mutable: false },
        generics: { parameters: [], wherePredicates: [] }, params: [], returnType: nested },
    ] }]);
  assert.equal(normalized.aliases.length, 1);
  const source = `${[...normalized.aliases, ...normalized.items].map(printRustItem).join("\n")}
pub struct Identity;
impl Family for Identity {
    type Output = i64;
    fn read(&self) -> Vec<Option<Vec<Option<Vec<i64>>>>> { vec![Some(vec![Some(vec![9007199254740993])])] }
}
#[test]
fn exact_projection_preserves_native_output() {
    assert_eq!(Identity.read()[0].as_ref().unwrap()[0].as_ref().unwrap()[0], 9007199254740993);
}
`;
  const directory = writeGeneratedProject("native_associated_signature_aliases", [
    { path: "Cargo.toml", text: '[package]\nname = "native_associated_signature_aliases"\nversion = "0.1.0"\nedition = "2024"\n' },
    { path: "src/lib.rs", text: source },
  ]);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline"]);
});
