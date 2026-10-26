import { join as joinPath } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeAllocationSupport } from "../../helpers/native-ownership-cost.mjs";
import { planRustNativeErrorJoin } from "../../../dist/backend/planner/types/native-error-joins.js";
import { rustErrorType, rustNativeFallibleBoundary, rustInjectLocalError,
  rustInjectNativeError, rustPropagateLocalError, rustPropagateNativeError } from "../../../dist/backend/planner/program/fallible-boundaries.js";
import { applyRustFallibleResultExpression } from "../../../dist/backend/planner/types/fallible-shape.js";
import { lowerRustCompletionScope } from "../../../dist/backend/target-ast/normalization/completion-regions.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustRuntimeCratePath } from "../../helpers/rust-session-paths.mjs";

test("native error sums derive Debug conditionally without constraining arbitrary payloads", { timeout: 300_000 }, () => {
  const joined = planRustNativeErrorJoin({ identity: "fixture:conditional-debug", name: "NativeErrors", visibility: "public", resultShape: "result",
    sources: [
      { identity: "first", variant: "First", errorType: { kind: "primitive", name: "i32" } },
      { identity: "second", variant: "Second", errorType: { kind: "primitive", name: "u32" } },
    ],
  });
  assert.equal(joined !== undefined, true);
  const emitted = printRustSourceFile(finalizeRustSourceStyle({ items: joined.items }));
  assert.match(emitted, /#\[derive\(Debug\)\]\s+pub enum NativeErrors<Error0, Error1>/u);
  assert.doesNotMatch(emitted, /Error[01]:|where|Clone|Box|dyn/u);
  const project = writeGeneratedProject("native-error-debug", [
    { path: "Cargo.toml", text: `[package]\nname = "native_error_debug"\nversion = "0.0.0"\nedition = "2024"\n[features]\ndemand-debug = []\n` },
    { path: "src/main.rs", text: `${emitted}
struct Silent(u32);
fn main() -> Result<(), NativeErrors<i32, u32>> {
    let hidden = NativeErrors::<Silent, Silent>::First(Silent(41));
    match hidden {
        NativeErrors::First(Silent(value)) => assert_eq!(value, 41),
        NativeErrors::Second(_) => unreachable!(),
    }
    let shown = NativeErrors::<i32, u32>::Second(7);
    assert_eq!(format!("{shown:?}"), "Second(7)");
    #[cfg(feature = "demand-debug")]
    {
        let hidden = NativeErrors::<Silent, u32>::First(Silent(1));
        std::hint::black_box(format!("{hidden:?}"));
    }
    Ok(())
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["rustc", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
  assert.throws(() => runCargo(project, ["check", "--locked", "--offline", "--features", "demand-debug"]),
    error => /E0277/u.test(error.message) && /Silent/u.test(error.message) && /Debug/u.test(error.message));
});

const named = (path, ...types) => ({ kind: "named", path,
  ...(types.length === 0 ? {} : { genericArguments: types.map(type => ({ kind: "type", type })) }) });
const path = name => ({ kind: "path", path: name });
const call = (path, args = []) => ({ kind: "call", path, args });
const invoke = name => ({ kind: "method-call", receiver: path(name), method: "invoke", args: [] });
const reference = referent => ({ kind: "reference", mutable: true, referent });
const number = { kind: "primitive", name: "u32" };
const lifetime = { kind: "named", name: "scope" };
const lifetimeParameter = { kind: "lifetime", name: "scope", outlives: [] };
const producerParameter = name => ({ kind: "type", name, bounds: [{ kind: "trait", path: "Invocation" }] });
const associatedError = producer => ({ kind: "qualified", owner: named(producer), trait: named("Invocation"), member: "Error" });
const borrowedError = { kind: "named", path: "BorrowedError", genericArguments: [{ kind: "lifetime", lifetime }] };
const source = (identity, variant, errorType) => ({ identity, variant, errorType });
const local = source("local", "Local", borrowedError);
const left = source("callback:left", "Left", associatedError("LeftCallback"));
const right = source("callback:right", "Right", associatedError("RightCallback"));
const generics = { parameters: [lifetimeParameter, producerParameter("LeftCallback"), producerParameter("RightCallback")], wherePredicates: [] };
const join = planRustNativeErrorJoin({ identity: "native:joined", name: "JoinedErrors", visibility: "private", resultShape: "result",
  sources: [local, left, right] });

function nativeFunctions() {
  assert.equal(join !== undefined, true);
  const region = rustNativeFallibleBoundary(join);
  assert.equal(region !== undefined, true);
  const localCheck = { kind: "expr", expr: { kind: "if-let", expression: path("local"),
    pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "error" }] },
    whenTrue: { kind: "return-expression", expr: call("Err", [rustInjectNativeError(region, local, path("error"))]) } } };
  const joined = { kind: "function", name: "invoke_joined", visibility: "private", generics, returnType: number, errorType: join.errorType,
    params: [{ name: "local", type: named("Option", borrowedError) },
      { name: "left", type: reference(named("LeftCallback")) }, { name: "right", type: reference(named("RightCallback")) }],
    body: { statements: [localCheck,
      { kind: "let", name: "first", mutable: false, init: rustPropagateNativeError(region, left, invoke("left")) },
      { kind: "let", name: "second", mutable: false, init: rustPropagateNativeError(region, right, invoke("right")) },
      { kind: "tail", expr: call("Ok", [{ kind: "binary", operator: "+", left: path("first"), right: path("second") }]) },
    ] } };
  const single = source("only", "Only", associatedError("Callback"));
  const singleGenerics = { parameters: [producerParameter("Callback")], wherePredicates: [] };
  const exact = planRustNativeErrorJoin({ identity: "native:single", name: "UnusedSingleError", visibility: "private", resultShape: "result",
    sources: [single] });
  const exactRegion = rustNativeFallibleBoundary(exact);
  assert.equal(exactRegion !== undefined, true);
  const pureGenerics = { parameters: [{ kind: "type", name: "Callback", bounds: [{ kind: "callable", trait: "Fn", binder: [],
    parameters: [], result: number }] }], wherePredicates: [] };
  const pure = planRustNativeErrorJoin({ identity: "native:pure", name: "UnusedPureError", visibility: "private", resultShape: "value",
    sources: [] });
  const completion = { kind: "try-scope", bodyName: "body_flow", flowName: "flow", finallyName: "finally_flow",
    dispatchResultWrapped: true,
    returnType: { kind: "unit" }, errorType: join.errorType, bodyErrorType: join.errorType, asynchronous: false,
    body: { statements: [{ kind: "expr", expr: rustPropagateNativeError(region, left, invoke("left")) },
      { kind: "expr", expr: rustPropagateNativeError(region, right, invoke("right")) }] }, bodyTerminates: false,
    finallyClause: { errorType: undefined, terminates: false, body: { statements: [{ kind: "expr", expr: {
      kind: "method-call", receiver: path("finalized"), method: "set", args: [{ kind: "binary", operator: "+",
        left: { kind: "method-call", receiver: path("finalized"), method: "get", args: [] }, right: { kind: "int-literal", text: "1" } }],
    } }] } }, propagate: false, dispatchReturn: false, dispatchTargets: [], terminates: false };
  return [...join.items, ...exact.items, ...pure.items, joined,
    { kind: "function", name: "invoke_single", visibility: "private", generics: singleGenerics, returnType: number, errorType: exact.errorType,
      params: [{ name: "callback", type: reference(named("Callback")) }], body: { statements: [{ kind: "tail",
        expr: applyRustFallibleResultExpression(rustPropagateNativeError(exactRegion, single, invoke("callback")), exactRegion) }] } },
    { kind: "function", name: "invoke_pure", visibility: "private", generics: pureGenerics, returnType: number,
      params: [{ name: "callback", type: named("Callback") }], body: { statements: [{ kind: "tail",
        expr: { kind: "invoke", callee: path("callback"), args: [] } }] } },
    { kind: "function", name: "complete_joined", visibility: "private", generics, returnType: { kind: "unit" }, errorType: join.errorType,
      params: [{ name: "left", type: reference(named("LeftCallback")) }, { name: "right", type: reference(named("RightCallback")) },
        { name: "finalized", type: { kind: "reference", mutable: false, referent: named("core::cell::Cell", number) } }],
      body: { statements: [lowerRustCompletionScope(completion), { kind: "tail", expr: call("Ok", [{ kind: "tuple-literal", elements: [] }]) }] } },
  ];
}

function packageRegionFunctions() {
  const owner = { componentId: "fixture:source-package", errorDomain: "project",
    errorTypeIdentity: "fixture:local-failure", errorTypePath: "LocalFailure" };
  const local = source("package:local", "Local", rustErrorType(owner));
  const generics = { parameters: [producerParameter("LeftCallback"), producerParameter("RightCallback")], wherePredicates: [] };
  const joined = planRustNativeErrorJoin({ identity: "fixture:package-join", name: "PackageErrors", visibility: "private", resultShape: "result",
    sources: [local, left, right] });
  const region = rustNativeFallibleBoundary(joined, { owner, source: local });
  assert.equal(region !== undefined, true);
  return [...joined.items, {
    kind: "function", name: "invoke_package", visibility: "private", generics, returnType: number, errorType: region.errorType,
    params: [{ name: "local", type: named("Result", number, named("OperationFailure")) },
      { name: "left", type: reference(named("LeftCallback")) }, { name: "right", type: reference(named("RightCallback")) }],
    body: { statements: [
      { kind: "let", name: "first", mutable: false, init: rustPropagateLocalError(region, named("OperationFailure"), path("local")) },
      { kind: "let", name: "second", mutable: false, init: rustPropagateNativeError(region, left, invoke("left")) },
      { kind: "let", name: "third", mutable: false, init: rustPropagateNativeError(region, right, invoke("right")) },
      { kind: "tail", expr: call("Ok", [{ kind: "binary", operator: "+", left: path("first"), right: {
        kind: "binary", operator: "+", left: path("second"), right: path("third"),
      } }]) },
    ] },
  }, {
    kind: "function", name: "inject_package", visibility: "private", generics, returnType: region.errorType,
    params: [{ name: "error", type: local.errorType }],
    body: { statements: [{ kind: "tail", expr: rustInjectLocalError(region, path("error")) }] },
  }];
}

function genericAssociatedFunctions() {
  const parameters = [lifetimeParameter, { kind: "type", name: "Factory", bounds: [{ kind: "trait", path: "ErrorFactory" }] },
    { kind: "const", name: "COUNT", type: { kind: "primitive", name: "usize" } }];
  const generics = { parameters, wherePredicates: [] };
  const associated = source("gat", "Associated", { kind: "qualified", owner: named("Factory"), trait: named("ErrorFactory"), member: "Error",
    genericArguments: [{ kind: "lifetime", lifetime }] });
  const array = source("array", "Array", { kind: "reference", mutable: true, lifetime, referent: {
    kind: "fixed-array", element: number, length: { kind: "path", path: "COUNT" },
  } });
  const joined = planRustNativeErrorJoin({ identity: "native:gat", name: "AssociatedErrors", visibility: "private", resultShape: "result",
    sources: [associated, array] });
  return [...joined.items, ...[associated, array].map((selected, index) => ({ kind: "function",
    name: index === 0 ? "inject_associated" : "inject_array", visibility: "private", generics, returnType: joined.errorType,
    params: [{ name: "error", type: selected.errorType }], body: { statements: [{ kind: "tail", expr: joined.inject(selected, path("error")) }] },
  }))];
}

test("native joined errors preserve associated borrows, moves, distinct sources and zero allocations", { timeout: 300_000 }, () => {
  const emitted = printRustSourceFile(finalizeRustSourceStyle({ headerComment: "exact error join syntax",
    items: [...nativeFunctions(), ...genericAssociatedFunctions()] }));
  assert.doesNotMatch(emitted, /TsonicError|TsonicResult|::from\(|\.clone\(|Default|Box|dyn |'static|UnusedPureError|UnusedSingleError/u);
  assert.match(emitted, /fn invoke_pure<Callback: Fn\(\) -> u32>\(callback: Callback\) -> u32/u);
  assert.match(emitted, /enum JoinedErrors<Error0, Error1, Error2>/u);
  assert.match(emitted, /map_err\(\s*JoinedErrors::<\s*BorrowedError<'scope>,\s*<LeftCallback as Invocation>::Error,\s*<RightCallback as Invocation>::Error,?\s*>::Left,?\s*\)/u);
  const packageEmitted = printRustSourceFile(finalizeRustSourceStyle({ headerComment: "exact local package routing",
    items: packageRegionFunctions() }));
  assert.match(packageEmitted, /local\s*\.map_err\(LocalFailure::from\)\s*\.map_err\(\s*PackageErrors::<\s*LocalFailure,\s*<LeftCallback as Invocation>::Error,\s*<RightCallback as Invocation>::Error,?\s*>::Local,?\s*\)\?/u);
  assert.doesNotMatch(packageEmitted, /TsonicError|TsonicResult|PackageErrors[^\n]*::from|\.clone\(|Default|Box|dyn |'static/u);
  const project = writeGeneratedProject("native-error-joins", [
    { path: "Cargo.toml", text: `[package]\nname = "native_error_joins"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]\ntsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)}, default-features = false }\n` },
  ]);
  const source = `use tsonic_rust_runtime as rt;
use core::cell::Cell;
${nativeAllocationSupport(project)}
trait Invocation {
    type Error;
    fn invoke(&mut self) -> Result<u32, Self::Error>;
}
struct BorrowedError<'scope> {
    value: &'scope mut u32,
    drops: &'scope Cell<u32>,
}
impl Drop for BorrowedError<'_> {
    fn drop(&mut self) { self.drops.set(self.drops.get() + 1); }
}
struct Callback<'scope> {
    pending: Option<BorrowedError<'scope>>,
    calls: &'scope Cell<u32>,
}
impl<'scope> Invocation for Callback<'scope> {
    type Error = BorrowedError<'scope>;
    fn invoke(&mut self) -> Result<u32, Self::Error> {
        self.calls.set(self.calls.get() + 1);
        match self.pending.take() { Some(error) => Err(error), None => Ok(4) }
    }
}
trait ErrorFactory { type Error<'scope>; }
struct Factory;
impl ErrorFactory for Factory { type Error<'scope> = BorrowedError<'scope>; }
struct OperationFailure { value: u32 }
struct LocalFailure { value: u32 }
impl From<OperationFailure> for LocalFailure {
    fn from(error: OperationFailure) -> Self { Self { value: error.value } }
}
${emitted}
${packageEmitted}
fn main() {
    let control = allocation_counts::allocation_requests_all_threads();
    let allocated = Box::new(std::hint::black_box(7_u32));
    std::hint::black_box(&allocated);
    drop(allocated);
    assert!(allocation_counts::allocation_requests_all_threads() > control);
    let before = allocation_counts::allocation_requests_all_threads();
    for branch in 0..4 {
        let (mut local_value, mut left_value, mut right_value) = (10, 20, 30);
        let pointers = [std::ptr::from_ref(&local_value), std::ptr::from_ref(&left_value), std::ptr::from_ref(&right_value)];
        let drops = Cell::new(0);
        let left_calls = Cell::new(0);
        let right_calls = Cell::new(0);
        let local = if branch == 0 { Some(BorrowedError { value: &mut local_value, drops: &drops }) } else { None };
        let mut left = Callback { pending: if branch == 1 { Some(BorrowedError { value: &mut left_value, drops: &drops }) } else { None }, calls: &left_calls };
        let mut right = Callback { pending: if branch == 2 { Some(BorrowedError { value: &mut right_value, drops: &drops }) } else { None }, calls: &right_calls };
        let outcome = invoke_joined(local, &mut left, &mut right);
        let error = match outcome {
            Err(JoinedErrors::Local(error)) => { assert_eq!(branch, 0); Some(error) }
            Err(JoinedErrors::Left(error)) => { assert_eq!(branch, 1); Some(error) }
            Err(JoinedErrors::Right(error)) => { assert_eq!(branch, 2); Some(error) }
            Ok(value) => { assert_eq!(branch, 3); assert_eq!(value, 8); None }
        };
        if let Some(error) = error {
            assert_eq!(std::ptr::from_ref(&*error.value), pointers[branch]);
            *error.value += 1;
            drop(error);
        }
        assert_eq!(drops.get(), u32::from(branch < 3));
        assert_eq!(left_calls.get(), u32::from(branch > 0));
        assert_eq!(right_calls.get(), u32::from(branch > 1));
    }
    for branch in 0..4 {
        let (mut left_value, mut right_value) = (20, 30);
        let pointers = [std::ptr::from_ref(&left_value), std::ptr::from_ref(&right_value)];
        let drops = Cell::new(0);
        let left_calls = Cell::new(0);
        let right_calls = Cell::new(0);
        let local = if branch == 0 { Err(OperationFailure { value: 41 }) } else { Ok(2) };
        let mut left = Callback { pending: if branch == 1 { Some(BorrowedError { value: &mut left_value, drops: &drops }) } else { None }, calls: &left_calls };
        let mut right = Callback { pending: if branch == 2 { Some(BorrowedError { value: &mut right_value, drops: &drops }) } else { None }, calls: &right_calls };
        let error = match invoke_package(local, &mut left, &mut right) {
            Err(PackageErrors::Local(error)) => { assert_eq!(branch, 0); assert_eq!(error.value, 41); None }
            Err(PackageErrors::Left(error)) => { assert_eq!(branch, 1); Some(error) }
            Err(PackageErrors::Right(error)) => { assert_eq!(branch, 2); Some(error) }
            Ok(value) => { assert_eq!(branch, 3); assert_eq!(value, 10); None }
        };
        if let Some(error) = error {
            assert_eq!(std::ptr::from_ref(&*error.value), pointers[branch - 1]);
            *error.value += 1;
            drop(error);
        }
        assert_eq!(drops.get(), u32::from(branch == 1 || branch == 2));
        assert_eq!(left_calls.get(), u32::from(branch > 0));
        assert_eq!(right_calls.get(), u32::from(branch > 1));
    }
    match inject_package::<Callback<'_>, Callback<'_>>(LocalFailure { value: 17 }) {
        PackageErrors::Local(error) => assert_eq!(error.value, 17),
        _ => panic!("wrong injected package variant"),
    }
    let drops = Cell::new(0);
    let calls = Cell::new(0);
    let finalized = Cell::new(0);
    let mut value = 7;
    let original = std::ptr::from_ref(&value);
    let mut failing = Callback { pending: Some(BorrowedError { value: &mut value, drops: &drops }), calls: &calls };
    let mut passing = Callback { pending: None, calls: &calls };
    match complete_joined(&mut failing, &mut passing, &finalized) {
        Err(JoinedErrors::Left(error)) => { assert_eq!(std::ptr::from_ref(&*error.value), original); drop(error); }
        _ => panic!("wrong completion variant"),
    }
    assert_eq!(finalized.get(), 1);
    assert_eq!(drops.get(), 1);
    assert!(matches!(invoke_single(&mut passing), Ok(4)));
    assert_eq!(invoke_pure(|| 9), 9);
    let mut single_value = 11;
    let original = std::ptr::from_ref(&single_value);
    let mut single = Callback { pending: Some(BorrowedError { value: &mut single_value, drops: &drops }), calls: &calls };
    match invoke_single(&mut single) {
        Err(error) => { assert_eq!(std::ptr::from_ref(&*error.value), original); drop(error); }
        _ => panic!("single error lost"),
    }
    assert_eq!(drops.get(), 2);
    let mut associated_value = 13;
    {
        let joined = inject_associated::<Factory, 3>(BorrowedError { value: &mut associated_value, drops: &drops });
        match joined { AssociatedErrors::Associated(error) => { *error.value = 14; drop(error); }, _ => panic!("GAT error lost") }
    }
    assert_eq!(associated_value, 14);
    assert_eq!(drops.get(), 3);
    let mut array = [1, 2, 3];
    match inject_array::<Factory, 3>(&mut array) {
        AssociatedErrors::Array(values) => values[1] = 7,
        _ => panic!("const error lost"),
    }
    assert_eq!(array, [1, 7, 3]);
    assert_eq!(allocation_counts::allocation_requests_all_threads(), before);
}
`;
  mkdirSync(joinPath(project, "src"), { recursive: true });
  writeFileSync(joinPath(project, "src/main.rs"), source);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
});
