import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { emptyRustGenerics, createRustSourceFile } from "../../../dist/backend/target-ast/syntax/nodes.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustNativeFutureType } from "../../../dist/backend/planner/types/native-futures.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const named = path => ({ kind: "named", path });
const unit = { kind: "unit" };
const lifetime = { kind: "named", name: "input" };
const lifetimeParameter = { kind: "lifetime", name: "input", outlives: [] };
const typeParameter = { kind: "type", name: "Value", bounds: [] };
const constParameter = { kind: "const", name: "COUNT", type: { kind: "primitive", name: "usize" } };
const generics = (parameters, wherePredicates = []) => ({ parameters, wherePredicates });
const borrow = referent => ({ kind: "reference", mutable: true, lifetime, referent });
const result = (output, error) => ({ kind: "named", path: "Result", genericArguments: [
  { kind: "type", type: output }, { kind: "type", type: error },
] });
const typeArgument = type => ({ kind: "type", type });
const lifetimeArgument = { kind: "lifetime", lifetime };
const invokeBody = success => ({ statements: [{ kind: "tail", expr: { kind: "call", path: success ? "Ok" : "Err",
  args: [{ kind: "path", path: "value" }] } }] });

function protocol({ name, producer, selectedGenerics, methodGenerics = selectedGenerics, arguments_, input,
  error, output = unit, success = false, asynchronous = false }) {
  const associated = { kind: "qualified", owner: named("Self"), member: "Error", genericArguments: arguments_ };
  const completion = result(output, associated);
  const returnType = asynchronous ? rustNativeFutureType(completion, { kind: "opaque",
    captures: [lifetimeArgument, typeArgument(named("Self"))] }) : completion;
  const method = { kind: "function", name: "invoke", generics: methodGenerics,
    selfParam: { kind: "reference", mutable: false }, params: [{ name: "value", type: input }], returnType };
  const body = invokeBody(success);
  return [
    { kind: "trait", name, visibility: "public", generics: emptyRustGenerics, members: [
      { kind: "type", name: "Error", generics: selectedGenerics, bounds: [] }, method,
    ] },
    { kind: "struct", name: producer, visibility: "public", generics: emptyRustGenerics, fields: [] },
    { kind: "impl", trait: named(name), target: named(producer), generics: emptyRustGenerics, members: [
      { kind: "type", name: "Error", generics: selectedGenerics, type: error },
      { ...method, visibility: "private", returnType: asynchronous
        ? rustNativeFutureType(completion, { kind: "opaque", captures: [lifetimeArgument] }) : completion,
      body: asynchronous
        ? { statements: [{ kind: "tail", expr: { kind: "async-block", move: true, body } }] } : body },
    ] },
  ];
}

function items() {
  const integer = { kind: "primitive", name: "u32" };
  const combined = borrow({ kind: "fixed-array", element: named("Value"), length: { kind: "path", path: "COUNT" } });
  return [
    ...protocol({ name: "InputError", producer: "BorrowInput", selectedGenerics: generics([lifetimeParameter]),
      arguments_: [lifetimeArgument], input: borrow(integer), error: borrow(integer) }),
    ...protocol({ name: "GenericError", producer: "ReturnValue", selectedGenerics: generics([typeParameter]),
      arguments_: [typeArgument(named("Value"))], input: named("Value"), error: named("Value") }),
    ...protocol({ name: "CombinedError", producer: "BorrowArray", selectedGenerics: generics([
      lifetimeParameter, typeParameter, constParameter,
    ], [{ kind: "type", type: named("Value"), bounds: [{ kind: "lifetime", lifetime }] }]),
    arguments_: [lifetimeArgument, typeArgument(named("Value")), { kind: "const", value: { kind: "path", path: "COUNT" } }],
    input: combined, error: combined }),
    ...protocol({ name: "IndependentError", producer: "Pure", selectedGenerics: emptyRustGenerics,
      methodGenerics: generics([typeParameter]), arguments_: [], input: named("Value"), error: named("core::convert::Infallible"),
      output: named("Value"), success: true }),
    ...protocol({ name: "FutureInputError", producer: "DeferredBorrow", selectedGenerics: generics([lifetimeParameter]),
      arguments_: [lifetimeArgument], input: borrow(integer), error: borrow(integer), asynchronous: true }),
  ];
}

function declarations(selected = items()) {
  return printRustSourceFile(finalizeRustSourceStyle(createRustSourceFile(selected)));
}

test("generated GAT errors retain invocation lifetimes, type/const parameters and plain independent errors", { timeout: 300_000 }, () => {
  const source = declarations();
  assert.match(source, /type Error<'input> = &'input mut u32;/u);
  assert.match(source, /type Error<Value> = Value;/u);
  assert.match(source, /type Error = core::convert::Infallible;/u);
  assert.doesNotMatch(source, /Box|dyn |Clone|\.clone\(|TsonicError|TsonicResult|'static|unsafe/u);
  const project = writeGeneratedProject("generic-associated-errors", [
    { path: "Cargo.toml", text: '[package]\nname = "generic_associated_errors"\nversion = "0.0.0"\nedition = "2024"\n' },
    { path: "src/main.rs", text: `${source}
struct NonClone(u32);
fn ready<Output>(future: impl core::future::Future<Output = Output>) -> Output {
    match std::pin::pin!(future).as_mut().poll(&mut std::task::Context::from_waker(std::task::Waker::noop())) {
        std::task::Poll::Ready(output) => output,
        std::task::Poll::Pending => panic!("unexpected suspension"),
    }
}
fn main() {
    let mut value = 7;
    let address = core::ptr::from_ref(&value);
    let error = BorrowInput {}.invoke(&mut value).unwrap_err();
    assert_eq!(core::ptr::from_ref(&*error), address);
    *error = 9;
    assert_eq!(value, 9);
    let error = ReturnValue {}.invoke(NonClone(11)).unwrap_err();
    assert_eq!(error.0, 11);
    let error = ReturnValue {}.invoke(false).unwrap_err();
    assert!(!error);
    let mut values = [NonClone(13), NonClone(15)];
    let original = core::ptr::from_ref(&values);
    let error = BorrowArray {}.invoke(&mut values).unwrap_err();
    assert_eq!(core::ptr::from_ref(&*error), original);
    error[0].0 += 4;
    assert_eq!(values[0].0, 17);
    assert_eq!(Pure {}.invoke(NonClone(19)).unwrap().0, 19);
    let future = { let producer = DeferredBorrow {}; producer.invoke(&mut value) };
    let error = ready(future).unwrap_err();
    assert_eq!(core::ptr::from_ref(&*error), address);
    *error = 23;
    assert_eq!(value, 23);
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
});

function rejected(name, source, expected) {
  const project = writeGeneratedProject(name, [{ path: "lib.rs", text: source }]);
  const compiled = spawnSync("rustc", ["--edition=2024", "--crate-type=lib", "--emit=metadata", "--error-format=json",
    "lib.rs", "-o", resolve(project, "lib.rmeta")], { cwd: project, encoding: "utf8", timeout: 60_000, maxBuffer: 262_144 });
  assert.equal(compiled.error === undefined, true, `${name}: native compiler process`);
  assert.equal(compiled.signal === null, true, `${name}: native compiler signal`);
  assert.notEqual(compiled.status, 0, `${name}: invalid native program admitted`);
  const errors = compiled.stderr.split("\n").filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line)).filter(diagnostic => diagnostic.level === "error");
  assert.equal(errors.some(diagnostic => expected.test(diagnostic.message)), true,
    `${name}: ${errors.map(diagnostic => `${diagnostic.code?.code ?? "error"}: ${diagnostic.message}`).join("; ")}`);
}

test("native GAT misuse preserves lifetime, ownership, binder, type and bound rejection", { timeout: 300_000 }, () => {
  const source = declarations();
  for (const [name, body, expected] of [
    ["gat-error-borrow-escape", "fn invalid() -> &'static mut u32 { let mut value = 3; BorrowInput {}.invoke(&mut value).unwrap_err() }",
      /cannot return value referencing local variable/u],
    ["gat-error-moved-value", "struct NonClone(u32); fn invalid() { let value = NonClone(3); let error = ReturnValue {}.invoke(value).unwrap_err(); let _used = value.0 + error.0; }",
      /use of moved value/u],
    ["gat-error-wrong-type", "fn invalid() { let _: Result<(), u32> = ReturnValue {}.invoke(false); }", /mismatched types/u],
    ["gat-error-wrong-arity", "fn invalid(_: <ReturnValue as GenericError>::Error) {}", /missing generics/u],
    ["gat-error-wrong-owner", "fn invalid(_: <BorrowInput as GenericError>::Error<u32>) {}", /trait bound.*GenericError.*not satisfied/u],
    ["gat-error-wrong-count", "fn invalid(value: &mut [u32; 2]) { let _: Result<(), &mut [u32; 3]> = BorrowArray {}.invoke(value); }", /mismatched types/u],
  ]) rejected(name, `${source}\n${body}`, expected);
  const missing = items().map(item => item.kind === "impl" && item.trait.path === "InputError"
      ? { ...item, members: item.members.map(member => member.kind === "type" ? { ...member, generics: emptyRustGenerics } : member) }
      : item);
  rejected("gat-error-missing-binder", declarations(missing), /undeclared lifetime name/u);
  const noBounds = items().map(item => item.kind === "impl" && item.trait.path === "CombinedError"
    ? { ...item, members: item.members.map(member => member.kind === "type"
      ? { ...member, generics: { ...member.generics, wherePredicates: [] } } : member) } : item);
  rejected("gat-error-missing-outlives", declarations(noBounds), /may not live long enough/u);
});
