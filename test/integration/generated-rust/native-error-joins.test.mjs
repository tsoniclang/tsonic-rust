import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeErrorJoin } from "../../../dist/backend/planner/types/native-error-joins.js";
import { applyRustFallibleResultExpression } from "../../../dist/backend/planner/types/fallible-shape.js";
import { lowerRustCompletionScope } from "../../../dist/backend/target-ast/normalization/completion-regions.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustRuntimeCratePath } from "../../helpers/rust-session/paths.mjs";

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
const join = planRustNativeErrorJoin({ identity: "native:joined", name: "JoinedErrors", visibility: "private", generics,
  sources: [local, left, right] });

function nativeFunctions() {
  assert.equal(join !== undefined, true);
  const localCheck = { kind: "expr", expr: { kind: "if-let", expression: path("local"),
    pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "error" }] },
    whenTrue: { kind: "return-expression", expr: call("Err", [join.inject(local, path("error"))]) } } };
  const joined = { kind: "function", name: "invoke_joined", visibility: "private", generics, returnType: number, errorType: join.errorType,
    params: [{ name: "local", type: named("Option", borrowedError) },
      { name: "left", type: reference(named("LeftCallback")) }, { name: "right", type: reference(named("RightCallback")) }],
    body: { statements: [localCheck,
      { kind: "let", name: "first", mutable: false, init: join.propagate(left, invoke("left")) },
      { kind: "let", name: "second", mutable: false, init: join.propagate(right, invoke("right")) },
      { kind: "tail", expr: call("Ok", [{ kind: "binary", operator: "+", left: path("first"), right: path("second") }]) },
    ] } };
  const single = source("only", "Only", associatedError("Callback"));
  const singleGenerics = { parameters: [producerParameter("Callback")], wherePredicates: [] };
  const exact = planRustNativeErrorJoin({ identity: "native:single", name: "UnusedSingleError", visibility: "private",
    generics: singleGenerics, sources: [single] });
  const pureGenerics = { parameters: [{ kind: "type", name: "Callback", bounds: [{ kind: "callable", trait: "Fn", binder: [],
    parameters: [], result: number }] }], wherePredicates: [] };
  const pure = planRustNativeErrorJoin({ identity: "native:pure", name: "UnusedPureError", visibility: "private",
    generics: pureGenerics, sources: [] });
  const completion = { kind: "try-scope", bodyName: "body_flow", flowName: "flow", finallyName: "finally_flow",
    returnType: { kind: "unit" }, errorType: join.errorType, bodyErrorType: join.errorType, asynchronous: false,
    body: { statements: [{ kind: "expr", expr: join.propagate(left, invoke("left")) },
      { kind: "expr", expr: join.propagate(right, invoke("right")) }] }, bodyTerminates: false,
    finallyClause: { errorType: undefined, terminates: false, body: { statements: [{ kind: "expr", expr: {
      kind: "method-call", receiver: path("finalized"), method: "set", args: [{ kind: "binary", operator: "+",
        left: { kind: "method-call", receiver: path("finalized"), method: "get", args: [] }, right: { kind: "int-literal", text: "1" } }],
    } }] } }, propagate: false, dispatchReturn: false, dispatchTargets: [], terminates: false };
  return [...join.items, ...exact.items, ...pure.items, joined,
    { kind: "function", name: "invoke_single", visibility: "private", generics: singleGenerics, returnType: number, errorType: exact.errorType,
      params: [{ name: "callback", type: reference(named("Callback")) }], body: { statements: [{ kind: "tail",
        expr: applyRustFallibleResultExpression(exact.propagate(single, invoke("callback")), { errorType: exact.errorType }) }] } },
    { kind: "function", name: "invoke_pure", visibility: "private", generics: pureGenerics, returnType: number,
      params: [{ name: "callback", type: named("Callback") }], body: { statements: [{ kind: "tail",
        expr: { kind: "invoke", callee: path("callback"), args: [] } }] } },
    { kind: "function", name: "complete_joined", visibility: "private", generics, returnType: { kind: "unit" }, errorType: join.errorType,
      params: [{ name: "left", type: reference(named("LeftCallback")) }, { name: "right", type: reference(named("RightCallback")) },
        { name: "finalized", type: { kind: "reference", mutable: false, referent: named("core::cell::Cell", number) } }],
      body: { statements: [lowerRustCompletionScope(completion), { kind: "tail", expr: call("Ok", [{ kind: "tuple-literal", elements: [] }]) }] } },
  ];
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
  const joined = planRustNativeErrorJoin({ identity: "native:gat", name: "AssociatedErrors", visibility: "private", generics,
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
  assert.match(emitted, /map_err\(JoinedErrors::<'scope, LeftCallback, RightCallback>::Left\)/u);
  const source = `use tsonic_rust_runtime as rt;
use core::cell::Cell;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
struct CountingAllocator;
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.realloc(pointer, layout, size) }
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
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
${emitted}
fn main() {
    let control = ALLOCATIONS.load(Ordering::SeqCst);
    let allocated = Box::new(std::hint::black_box(7_u32));
    std::hint::black_box(&allocated);
    drop(allocated);
    assert!(ALLOCATIONS.load(Ordering::SeqCst) > control);
    let before = ALLOCATIONS.load(Ordering::SeqCst);
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
    assert_eq!(ALLOCATIONS.load(Ordering::SeqCst), before);
}
`;
  const project = writeGeneratedProject("native-error-joins", [
    { path: "Cargo.toml", text: `[package]\nname = "native_error_joins"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]\ntsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)}, default-features = false }\n` },
    { path: "src/main.rs", text: source },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt", "--all"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
});
