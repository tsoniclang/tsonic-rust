import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "../../helpers/native-closure-producers.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { runCargo, writeGeneratedProject, validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { planRustCallableInputProducer, planRustCallableConversion }
  from "../../../dist/backend/planner/expressions/callable-conversions.js";

import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { nativeFallibleAdapterFixture, admitNativeCallableAdapter } from "../../helpers/physical-callable-adapters.mjs";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workspace = dirname(realpathSync(resolve(repository, "../tsonic")));
const runtime = resolve(workspace, "rust-runtime/crates/tsonic_rust_runtime");
const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", [], [], undefined, [], undefined, []);
const integer = rustSourcePrimitiveTargetType("int32");

test("source adapters retain their actual environment with native allocation, invocation and error identity parity",
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: [],
      target: { id: "rust", options: { outputType: "lib", crateName: "retained_adapter_cost" } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function adapt(callback: () => int32): (first: int32) => int32 {
  const widened: (first: int32) => int32 = callback;
  return widened;
}
export function forward(left: () => int32, right: () => int32): (first: int32) => int32 {
  const fromLeft = adapt(left);
  const fromRight = adapt(right);
  return fromRight;
}
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the actual source program produces native artifacts");
    const root = writeGeneratedProject("retained-adapter-cost", result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    const path = join(root, "tests/cost.rs");
    writeFileSync(path, `
use retained_adapter_cost::index;
use tsonic_rust_runtime as rt;
use rt::CallableImplementation;
${nativeOwnershipCostSupport}

#[derive(Debug, PartialEq, Eq)]
struct BorrowedFailure<'region>(&'region i32);

struct Input<'region> {
    value: &'region i32,
    calls: &'region Cell<usize>,
    fail: bool,
}

impl<'region> rt::CallableImplementation<()> for Input<'region> {
    type Output = Result<i32, BorrowedFailure<'region>>;

    fn invoke(&self, (): ()) -> Self::Output {
        self.calls.set(self.calls.get() + 1);
        if self.fail { Err(BorrowedFailure(self.value)) } else { Ok(*self.value) }
    }
}

fn direct<'region>(input: Input<'region>) -> rt::Callable<'region, (i32,), Result<i32, BorrowedFailure<'region>>> {
    rt::Callable::new(move |(_unused,): (i32,)| input.invoke(()))
}

fn direct_forward<'region>(left: Input<'region>, right: Input<'region>)
    -> rt::Callable<'region, (i32,), Result<i32, BorrowedFailure<'region>>> {
    let from_left = direct(left);
    let from_right = direct(right);
    drop(from_left);
    from_right
}

#[test]
fn one_required_adapter_never_acquires_a_return_wrapper() {
    let value = 31;
    let actual_calls = Cell::new(0);
    let expected_calls = Cell::new(0);
    for fail in [false, true] {
        actual_calls.set(0);
        expected_calls.set(0);
        let (compiled, actual) = measure(|| index::adapt(Input { value: &value, calls: &actual_calls, fail }));
        let (handwritten, expected) = measure(|| direct(Input { value: &value, calls: &expected_calls, fail }));
        assert_eq!(actual, expected);
        assert_eq!(actual.allocations, 1);
        println!("adapt fail={fail}: actual={actual:?}, handwritten={expected:?}");
        assert_eq!(actual_calls.get(), 0);
        assert_eq!(expected_calls.get(), 0);
        let (actual_result, actual_cost) = measure(|| compiled.call((7,)));
        let (expected_result, expected_cost) = measure(|| handwritten.call((7,)));
        assert_eq!(actual_result, expected_result);
        if let Err(error) = actual_result { assert!(core::ptr::eq(error.0, &value)); }
        assert_eq!(actual_calls.get(), 1);
        assert_eq!(expected_calls.get(), 1);
        assert_eq!(actual_cost, expected_cost);
        assert_eq!(actual_cost, Cost::default());
        let (_, actual_drop) = measure(|| drop(compiled));
        let (_, expected_drop) = measure(|| drop(handwritten));
        assert_eq!(actual_drop, expected_drop);
        assert_eq!(actual_drop.deallocations, 1);
    }
}

#[test]
fn forwarding_retains_only_the_actual_right_native_error() {
    let left_value = 11;
    let right_value = 43;
    let left_calls = Cell::new(0);
    let right_calls = Cell::new(0);
    let baseline_left = Cell::new(0);
    let baseline_right = Cell::new(0);
    for fail in [false, true] {
        right_calls.set(0);
        baseline_right.set(0);
        let (compiled, actual) = measure(|| index::forward(
            Input { value: &left_value, calls: &left_calls, fail: true },
            Input { value: &right_value, calls: &right_calls, fail },
        ));
        let (handwritten, expected) = measure(|| direct_forward(
            Input { value: &left_value, calls: &baseline_left, fail: true },
            Input { value: &right_value, calls: &baseline_right, fail },
        ));
        assert_eq!(actual, expected);
        assert_eq!(actual.allocations, 2);
        assert_eq!(actual.deallocations, 1);
        println!("forward fail={fail}: actual={actual:?}, handwritten={expected:?}");
        let (actual_result, actual_cost) = measure(|| compiled.call((5,)));
        let (expected_result, expected_cost) = measure(|| handwritten.call((5,)));
        assert_eq!(actual_result, expected_result);
        if let Err(error) = actual_result { assert!(core::ptr::eq(error.0, &right_value)); }
        assert_eq!(left_calls.get(), 0);
        assert_eq!(baseline_left.get(), 0);
        assert_eq!(right_calls.get(), 1);
        assert_eq!(baseline_right.get(), 1);
        assert_eq!(actual_cost, expected_cost);
        assert_eq!(actual_cost, Cost::default());
        let (_, actual_drop) = measure(|| drop(compiled));
        let (_, expected_drop) = measure(|| drop(handwritten));
        assert_eq!(actual_drop, expected_drop);
        assert_eq!(actual_drop.deallocations, 1);
    }
}
`);
    execFileSync("rustfmt", ["--edition", "2024", path], { cwd: root, timeout: 30_000 });
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt", "--all", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const execution = runCargo(root, ["test", "--locked", "--offline", "--", "--nocapture"]);
    process.stdout.write(execution.stdout);
  });

test("authored callable results use their actual copied or borrowed return environment", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "lib", crateName: "returned_capture_lifetime" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function copied<Region extends Life>(value: Ref<int32, Region>): () => int32 {
  const owned = load(value);
  return (): int32 => owned;
}
export function borrowed<Region extends Life>(value: Ref<int32, Region>): () => int32 {
  return (): int32 => load(value);
}
export function aliased<Region extends Life>(value: Ref<int32, Region>): () => int32 {
  const owned = load(value);
  const callback: () => int32 = (): int32 => owned;
  const result = callback;
  return ((result satisfies (() => int32)));
}
export function branches<Region extends Life>(left: Ref<int32, Region>, right: Ref<int32, Region>, selected: boolean): () => int32 {
  const first = load(left);
  const second = load(right);
  return selected ? (): int32 => first : (): int32 => second;
}
export function mixed<Region extends Life>(value: Ref<int32, Region>, selected: boolean): () => int32 {
  const owned = load(value);
  return selected ? (): int32 => owned : (): int32 => load(value);
}
` } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
  assert.equal(result.artifacts.length > 0, true, "exact copied and borrowed source results are admitted");
  const root = writeGeneratedProject("returned-capture-lifetime", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  const path = join(root, "tests/lifetimes.rs");
  const controls = `
use returned_capture_lifetime::index;

#[test]
fn copied_payload_outlives_the_original_input_loan() {
    let callback;
    {
        let value = 17;
        callback = index::copied(&value);
    }
    assert_eq!(callback.call(()), Ok(17));
    assert_eq!(callback.call(()), Ok(17));
}

#[test]
fn a_real_borrow_retains_the_input_region() {
    let value = 23;
    let callback = index::borrowed(&value);
    assert_eq!(callback.call(()), Ok(23));
    assert_eq!(callback.call(()), Ok(23));
}

#[test]
fn immutable_aliases_wrappers_and_result_branches_keep_the_real_copied_environment() {
    let alias;
    let left;
    let right;
    {
        let first = 29;
        let second = 31;
        alias = index::aliased(&first);
        left = index::branches(&first, &second, true);
        right = index::branches(&first, &second, false);
    }
    assert_eq!(alias.call(()), Ok(29));
    assert_eq!(left.call(()), Ok(29));
    assert_eq!(right.call(()), Ok(31));
}

#[test]
fn an_actual_borrow_in_either_result_branch_keeps_its_region() {
    let value = 37;
    assert_eq!(index::mixed(&value, true).call(()), Ok(37));
    assert_eq!(index::mixed(&value, false).call(()), Ok(37));
}
`;
  writeFileSync(path, controls);
  execFileSync("rustfmt", ["--edition", "2024", path], { cwd: root, timeout: 30_000 });
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
  for (const [name, inverse] of [
    ["borrowed", `
fn illegal_escape<'region>(value: &'region i32)
    -> tsonic_rust_runtime::Callable<'static, (), Result<i32, core::convert::Infallible>> {
    index::borrowed(value)
}
`],
    ["mixed", `
fn illegal_mixed_escape<'region>(value: &'region i32)
    -> tsonic_rust_runtime::Callable<'static, (), Result<i32, core::convert::Infallible>> {
    index::mixed(value, true)
}
`],
  ]) {
    writeFileSync(path, `${controls}${inverse}`);
    assert.throws(() => runCargo(root, ["check", "--all-targets", "--locked", "--offline"]),
      /(?:borrowed data escapes|lifetime may not live long enough|must outlive.*static)/u,
      `${name}: an actual input loan cannot be promoted to static or escape its native region`);
  }
});

test("checked adapters retain all error sources and match handwritten native allocation costs", { timeout: 300_000 }, () => {
  const fixture = nativeFallibleAdapterFixture();
  const expression = fixture.adapt();
  assert.equal(expression !== undefined, true);
  const emitted = printRustExpr(expression);
  const file = fixture.program.source.ast.getFileName(fixture.program.source.ast.getSourceFile(fixture.node));
  const declarations = printRustSourceFile(finalizeRustSourceStyle({ items: fixture.context.input.errorRegions.itemsFor(file) }));
  assert.doesNotMatch(emitted, /ConsumerFailure|\.clone\(|::from\(/u);
  const project = writeGeneratedProject("native-checked-callable-conversions", [
    { path: "Cargo.toml", text: `[package]\nname = "native_checked_callable_conversions"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]
tsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }
` },
    { path: "src/main.rs", text: `
use tsonic_rust_runtime as rt;
use std::sync::atomic::{AtomicUsize, Ordering};
${nativeOwnershipCostSupport}
mod index { ${declarations} }
#[derive(Debug)]
struct ProducerFailure(i32);
static CALLS: AtomicUsize = AtomicUsize::new(0);
fn original(value: i32) -> Result<i64, ProducerFailure> {
    CALLS.fetch_add(1, Ordering::SeqCst);
    match value { -1 => Err(ProducerFailure(value)), 2 => Ok(i64::MAX), other => Ok(i64::from(other)) }
}
type AdapterError = index::NativeErrors3<ProducerFailure, rt::TsonicError, rt::TsonicError>;
fn classify(result: Result<i32, AdapterError>) -> (u8, i32) {
    match result {
        Ok(value) => (0, value),
        Err(index::NativeErrors3::Error0(ProducerFailure(value))) => (1, value),
        Err(index::NativeErrors3::Error1(_)) => (2, 0),
        Err(index::NativeErrors3::Error2(_)) => (3, 0),
    }
}
fn main() {
    let (compiled, actual) = measure(|| ${emitted});
    let (handwritten, expected) = measure(|| rt::Callable::new(|(value,): (i64,)| {
        let parameter = rt::conversions::checked_integer::<i32>(value).map_err(AdapterError::Error1)?;
        let result = original(parameter).map_err(AdapterError::Error0)?;
        let output = rt::conversions::checked_integer::<i32>(result).map_err(AdapterError::Error2)?;
        Ok::<_, AdapterError>(output)
    }));
    assert_eq!(actual, expected);
    assert_eq!(actual.allocations, 1);
    for (value, outcome, calls) in [(4, (0, 4), 1), (-1, (1, -1), 1), (i64::MAX, (2, 0), 0), (2, (3, 0), 1)] {
        CALLS.store(0, Ordering::SeqCst);
        let (actual, actual_cost) = measure(|| compiled.call((value,)));
        assert_eq!(CALLS.load(Ordering::SeqCst), calls);
        CALLS.store(0, Ordering::SeqCst);
        let (expected, expected_cost) = measure(|| handwritten.call((value,)));
        assert_eq!(CALLS.load(Ordering::SeqCst), calls);
        assert_eq!(classify(actual), outcome);
        assert_eq!(classify(expected), outcome);
        assert_eq!(actual_cost, expected_cost);
    }
    println!("PASS: checked adapters preserve three exact error channels with native cost parity");
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["rustc", "--locked", "--offline", "--", "-D", "warnings"]);
  assert.match(runCargo(project, ["run", "--locked", "--offline", "--quiet"]).stdout, /PASS: checked adapters/u);
});

function fixtureExpressions(throwing) {
  const fixture = nativeClosureProducerFixture(throwing ? {
    packages: [nativeClosureProducerFailurePackage(failure)], source: `
import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 { return (): int32 => fail(); }
`, body: context => ({
      kind: "try", expr: { kind: "call", path: "fail", args: [] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType,
    }),
  } : {});
  const source = fixture.program.records.targetOperation.get(fixture.node).resultCarrier;
  const expression = fixture.plan();
  assert.equal(expression !== undefined, true);
  const input = planRustCallableInputProducer(expression, source, fixture.context, fixture.node);
  assert.equal(input !== undefined, true);
  const adapt = target => {
    const conversion = selectRustCallableConversion(source, target, () => undefined, fixture.program.typeDefinitions);
    assert.equal(conversion !== undefined, true);
    admitNativeCallableAdapter(fixture, conversion);
    const converted = planRustCallableConversion(conversion, expression, fixture.node, fixture.context);
    assert.equal(converted !== undefined, true);
    return printRustExpr(converted);
  };
  return { input: printRustExpr(input), borrowed: adapt(rustCallableInputTargetType([integer], integer)),
    owned: adapt(rustCallableTargetType([integer], integer)) };
}

test("generated dispatch, class-value, object and field helpers retain their selected callable ABI", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "contract.ts": `export interface Wide { get(): () => number | undefined; }
export interface Receiver { use(callback: () => number): number; }
export interface Factory { create(): () => number | undefined; }
export interface Holder { readonly callback: () => number | undefined; }
export interface Optional { get(): (() => number | undefined) | undefined; }`,
    "model.ts": `import type { Wide, Receiver, Factory, Holder, Optional } from "./contract.js";
export class Concrete implements Wide, Receiver, Optional {
  get(): () => number { return () => 7; }
  use(callback: (unused: number) => number): number { return callback(0); }
  static create(): () => number { return () => 13; }
}
export class Stored { readonly callback: () => number = () => 17; }
export function factory(): Factory { return Concrete; }
export function holder(): Holder { return new Stored(); }`,
    "index.ts": `import type { Wide, Receiver, Optional } from "./contract.js";
import { Concrete, factory, holder } from "./model.js";
const selected: Wide = new Concrete();
if (selected.get()() !== 7) throw new Error("project result adapter");
const receiver: Receiver = new Concrete();
if (receiver.use(() => 19) !== 19) throw new Error("project parameter adapter");
const object: Wide = { get() { return () => 11; } };
if (object.get()() !== 11) throw new Error("object dispatch adapter");
if (factory().create()() !== 13) throw new Error("class-value adapter");
if (holder().callback() !== 17) throw new Error("field ABI adapter");
const optional: Optional = new Concrete();
const callback = optional.get();
if (callback === undefined || callback() !== 7) throw new Error("optional helper adapter");`,
  } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => `${row.code}: ${row.message}`).join("\n"));
  validateGeneratedProject("selected-callable-helper-abi", result.artifacts, { run: true });
});

test("nested callable results and rest dispatch retain their distinct original helper ABI slots", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "contract.ts": `export interface NestedWide { read(): () => () => number | undefined; }
export interface NestedNarrow { read(): () => () => number; }
export interface RestReceiver { use(first: () => number, second: () => number): number; }`,
    "model.ts": `import type { NestedWide, NestedNarrow, RestReceiver } from "./contract.js";
export class Nested implements NestedWide, NestedNarrow {
  read(): () => () => number { return () => () => 23; }
}
export class Rest implements RestReceiver {
  use(...callbacks: ((unused: number) => number)[]): number {
    return callbacks[0](0) + callbacks[1](0);
  }
}`,
    "index.ts": `import type { NestedWide, NestedNarrow, RestReceiver } from "./contract.js";
import { Nested, Rest } from "./model.js";
const first: NestedWide = new Nested();
const second: NestedNarrow = new Nested();
if (first.read()()() !== 23) throw new Error("nested wide result adapter");
if (second.read()()() !== 23) throw new Error("distinct narrow helper view");
const receiver: RestReceiver = new Rest();
if (receiver.use(() => 29, () => 31) !== 60) throw new Error("both original rest adapter segments");`,
  } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => `${row.code}: ${row.message}`).join("\n"));
  validateGeneratedProject("nested-rest-callable-helper-abi", result.artifacts, { run: true });
});

test("physical callable adaptation retains exact E with one owning frame or zero borrowed allocations", { timeout: 300_000 }, () => {
  const pure = fixtureExpressions(false);
  const throwing = fixtureExpressions(true);
  const cases = [pure, throwing].map((selected, index) => `
    {
        let (input, cost) = measure(|| ${selected.input});
        assert_eq!(cost, Cost::default());
        let (result, cost) = measure(|| input(()));
        assert_eq!(result, ${index === 0 ? "Ok(3)" : "Err(ProducerFailure)"});
        assert_eq!(cost, Cost::default());
        let (result, cost) = measure(|| {
            let callback = ${selected.borrowed};
            callback((7,))
        });
        assert_eq!(result, ${index === 0 ? "Ok(3)" : "Err(ProducerFailure)"});
        assert_eq!(cost, Cost::default());
        let (owned, actual) = measure(|| ${selected.owned});
        let (direct, expected) = measure(|| rt::Callable::new(|(_unused,): (i32,)| ${index === 0 ? "Ok::<_, Infallible>(3i32)" : "fail()"}));
        assert_eq!(actual, expected);
        assert_eq!(actual.allocations, 1);
        let (result, cost) = measure(|| owned.call((7,)));
        assert_eq!(result, direct.call((7,)));
        assert_eq!(cost, Cost::default());
    }
`).join("\n");
  const project = writeGeneratedProject("native-callable-conversions", [
    { path: "Cargo.toml", text: `[package]\nname = "native_callable_conversions"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]
tsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }
` },
    { path: "src/main.rs", text: `
use tsonic_rust_runtime as rt;
use core::convert::Infallible;
${nativeOwnershipCostSupport}
#[derive(Debug, PartialEq, Eq)]
struct ProducerFailure;
fn fail() -> Result<i32, ProducerFailure> { Err(ProducerFailure) }
fn main() {
${cases}
    println!("PASS: physical callback adapter error identity and zero extra allocations");
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["rustc", "--offline", "--locked", "--", "-D", "warnings"]);
  assert.match(runCargo(project, ["run", "--offline", "--locked", "--quiet"]).stdout, /PASS: physical callback adapter/u);
});
