import assert from "node:assert/strict";
import test from "node:test";
import { spawnGeneratedCargo } from "../../helpers/cargo-target-pool.mjs";
import { realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourcePrimitiveTargetType, rustStrTargetType, rustFutureTargetType,
  rustSourceOptionalTargetType, rustSourceUnionTargetType, rustJsPromiseTargetType }
  from "../../../dist/target-model/types/index.js";
import { nativeProducerFixture, nativeProducerItems, printNativeProducerItems }
  from "../../helpers/native-producer-bridges.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workspace = dirname(realpathSync(resolve(repository, "../tsonic")));
const runtime = resolve(workspace, "rust-runtime/crates/tsonic_rust_runtime");
const javascript = resolve(workspace, "rust-js/crates/tsonic_rust_js");
const integer = rustSourcePrimitiveTargetType("uint64");
const boolean = rustSourcePrimitiveTargetType("bool");
const byte = rustSourcePrimitiveTargetType("uint8");
const borrowed = { kind: "reference", referent: rustStrTargetType(), mutable: false };

function fixtureSource(projectRoot) {
  const ordinary = nativeProducerFixture({ identity: "ordinary", parameters: [integer], result: integer });
  const second = nativeProducerFixture({ identity: "second", parameters: [integer], result: integer });
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const environment = nativeProducerFixture({ identity: "environment", parameters: [value], result: value });
  const reference = { kind: "reference", referent: value, mutable: false };
  const borrowedEnvironment = nativeProducerFixture({ identity: "borrowed-environment", parameters: [reference], result: reference });
  const pendingEnvironment = nativeProducerFixture({ identity: "pending-environment", parameters: [reference], result: rustFutureTargetType(reference) });
  const asynchronous = nativeProducerFixture({ identity: "asynchronous", parameters: [integer], result: rustFutureTargetType(integer) });
  const borrowing = nativeProducerFixture({ identity: "borrowing", parameters: [borrowed, byte], result: rustFutureTargetType(borrowed) });
  const js = nativeProducerFixture({ identity: "javascript", parameters: [integer, boolean],
    result: rustJsPromiseTargetType(integer) });
  const borrowedJs = nativeProducerFixture({ identity: "borrowed-javascript", parameters: [borrowed],
    result: rustJsPromiseTargetType(borrowed) });
  const definitions = createRustTypeDefinitionRegistry();
  const payloads = [borrowed, rustFutureTargetType(borrowed), rustFutureTargetType(integer)];
  const union = rustSourceUnionTargetType("/src/index.ts", "Union3", [], "generated", { kind: "physical", types: payloads });
  assert.equal(definitions.registerSourceUnion({ carrier: union,
    variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })),
  }, false), true, "mixed completion definition registers");
  const mixed = nativeProducerFixture({ identity: "mixed", parameters: [borrowed, byte],
    result: rustSourceOptionalTargetType(union), definitions });
  const emittedUnion = mixed.program.records.sourceUnion.get(union);
  assert.equal(emittedUnion !== undefined, true, "mixed completion has its canonical emitted union declaration");
  const shapesModule = mixed.context.structuralShapesModuleName;
  assert.equal(shapesModule.length > 0, true, "mixed completion uses the actual emitted shape module");
  const all = [ordinary, second, environment, asynchronous, borrowing, js, mixed,
    borrowedEnvironment, pendingEnvironment, borrowedJs];
  const names = all.map(fixture => fixture.protocol.targetName);
  const unique = [...new Map(all.map(fixture => [fixture.protocol.identity, fixture])).values()];
  assert.equal(unique.length, all.length - 1, "the equal ordinary callback contracts share one declaration and impl");
  const generated = printNativeProducerItems(unique.flatMap(nativeProducerItems));
  assert.doesNotMatch(generated, /TsonicError|TsonicResult|Box|dyn |\.clone\(|async move/u);
  const [ordinaryName, secondName, environmentName, asyncName, borrowName, jsName, mixedName,
    borrowedEnvironmentName, pendingEnvironmentName, borrowedJsName] = names;
  return `
use tsonic_rust_runtime as rt;
use tsonic_rust_js::abi as js_abi;
use core::convert::Infallible;
use core::future::Future;

${nativeOwnershipCostSupport(projectRoot)}

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct InvocationFailure<'input>(&'input str);
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct AwaitFailure<'input>(&'input str);
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct OtherAwaitFailure<'input>(&'input str);

pub mod ${shapesModule} {
    pub enum ${emittedUnion.targetName}<Ready, First, Second> {
        Variant0(Ready), Variant1(First), Variant2(Second),
    }
}
use ${shapesModule}::${emittedUnion.targetName};

${generated}

fn pure(value: u64) -> u64 { value + 1 }

fn asynchronous((value,): (u64,)) -> Result<impl Future<Output = Result<u64, AwaitFailure<'static>>>, InvocationFailure<'static>> {
    Ok(async move { if value == 0 { Err(AwaitFailure("async")) } else { Ok(value) } })
}

fn borrowing<'input>((value, branch): (&'input str, u8))
    -> Result<impl Future<Output = Result<&'input str, AwaitFailure<'input>>> + use<'input>, InvocationFailure<'input>> {
    if branch == 2 { return Err(InvocationFailure(value)); }
    Ok(async move { if branch == 1 { Err(AwaitFailure(value)) } else { Ok(value) } })
}

fn borrowed_environment<Value>((value,): (&Value,)) -> Result<&Value, Infallible> {
    Ok(value)
}

fn pending_environment<Value>((value,): (&Value,))
    -> Result<impl Future<Output = Result<&Value, Infallible>>, Infallible> {
    Ok(async move { Ok(value) })
}

fn borrowed_javascript((value,): (&str,)) -> Result<js_abi::JsPromise<&str>, Infallible> {
    Ok(js_abi::JsPromise::resolved(value))
}

fn mixed<'input>((value, branch): (&'input str, u8)) -> Result<Option<Union3<&'input str,
    impl Future<Output = Result<&'input str, AwaitFailure<'input>>> + use<'input>,
    impl Future<Output = Result<u64, OtherAwaitFailure<'input>>> + use<'input>>>, InvocationFailure<'input>> {
    match branch {
        0 => Ok(Some(Union3::Variant0(value))),
        1 | 4 => Ok(Some(Union3::Variant1(async move {
            if branch == 4 { Err(AwaitFailure(value)) } else { Ok(value) }
        }))),
        2 | 5 => Ok(Some(Union3::Variant2(async move {
            if branch == 5 { Err(OtherAwaitFailure(value)) } else { Ok(64) }
        }))),
        3 => Ok(None),
        _ => Err(InvocationFailure(value)),
    }
}

fn javascript((value, reject): (u64, bool))
    -> Result<js_abi::JsPromise<u64>, InvocationFailure<'static>> {
    Ok(if reject { js_abi::JsPromise::rejected(js_abi::JsValue::String(String::from("JS"))) } else { js_abi::JsPromise::resolved(value) })
}

fn complete<Value>(future: impl Future<Output = Value>) -> Value {
    let mut future = core::pin::pin!(future);
    match future.as_mut().poll(&mut core::task::Context::from_waker(core::task::Waker::noop())) {
        core::task::Poll::Ready(value) => value,
        core::task::Poll::Pending => panic!("fixture future did not complete"),
    }
}

fn both<Left: ${ordinaryName}, Right: ${ordinaryName}>(left: &Left, right: &Right) -> (u64, u64) {
    let Ok(left_value) = ${ordinaryName}::invoke(left, 7) else { panic!("left invocation failed") };
    let Ok(right_value) = ${ordinaryName}::invoke(right, 7) else { panic!("right invocation failed") };
    (left_value, right_value)
}

fn main() {
    let text = String::from("borrowed, not static");
    let text_ref = text.as_str();
    let pure_value = pure;
    let normalized = move |(value,)| Ok::<_, Infallible>(pure_value(value));
    let runtime = rt::Callable::new(|(value,): (u64,)| Ok::<_, InvocationFailure<'static>>(value + 2));
    let ((), cost) = measure(|| {
        assert_eq!(pure(7), 8);
        assert_eq!(${ordinaryName}::invoke(&normalized, 7), Ok(8));
        assert_eq!(${ordinaryName}::invoke(&runtime, 7), Ok(9));
        assert_eq!(${secondName}::invoke(&normalized, 7), Ok(8));
        assert_eq!(both(&normalized, &runtime), (8, 9));
        let payload = (37u64, core::marker::PhantomPinned);
        let returned = ${environmentName}::invoke(&|(value,)| Ok::<_, Infallible>(value), payload).unwrap();
        assert_eq!(returned.0, 37);
        let returned = ${borrowedEnvironmentName}::invoke(&borrowed_environment, &text_ref).unwrap();
        assert!(core::ptr::eq(returned, &text_ref));
        let returned = complete(${pendingEnvironmentName}::invoke(&pending_environment, &text_ref).unwrap()).unwrap();
        assert!(core::ptr::eq(returned, &text_ref));
        assert_eq!(complete(${asyncName}::invoke(&asynchronous, u64::MAX).unwrap()), Ok(u64::MAX));
        assert_eq!(complete(${asyncName}::invoke(&asynchronous, 0).unwrap()), Err(AwaitFailure("async")));
        let returned = complete(${borrowName}::invoke(&borrowing, &text, 0).unwrap()).unwrap();
        assert!(core::ptr::eq(returned.as_ptr(), text.as_ptr()));
        assert_eq!(complete(${borrowName}::invoke(&borrowing, &text, 1).unwrap()), Err(AwaitFailure(&text)));
        let Err(error) = ${borrowName}::invoke(&borrowing, &text, 2) else { panic!("missing invocation error") };
        assert_eq!(error, InvocationFailure(&text));
        for branch in 0..7 {
            match ${mixedName}::invoke(&mixed, &text, branch) {
                Ok(Some(Union3::Variant0(value))) => assert!(core::ptr::eq(value.as_ptr(), text.as_ptr())),
                Ok(Some(Union3::Variant1(pending))) => assert_eq!(complete(pending), if branch == 4 { Err(AwaitFailure(&text)) } else { Ok(text.as_str()) }),
                Ok(Some(Union3::Variant2(pending))) => assert_eq!(complete(pending), if branch == 5 { Err(OtherAwaitFailure(&text)) } else { Ok(64) }),
                Ok(None) => assert_eq!(branch, 3),
                Err(error) => assert_eq!(error, InvocationFailure(&text)),
            }
        }
        assert_eq!(core::mem::size_of_val(&normalized), core::mem::size_of_val(&pure_value));
        assert_eq!(core::mem::size_of::<Result<u64, Infallible>>(), core::mem::size_of::<u64>());
    });
    assert_eq!(cost, Cost::default());
    let (direct, direct_cost) = measure(|| complete(javascript((9, false)).unwrap().into_result()));
    let (bridged, bridge_cost) = measure(|| {
        let pending: js_abi::JsPromise<u64> = ${jsName}::invoke(&javascript, 9, false).unwrap();
        complete(pending.into_result())
    });
    assert_eq!(direct, Ok(9));
    assert_eq!(bridged, direct);
    assert_eq!(bridge_cost, direct_cost);
    assert_eq!(complete(${jsName}::invoke(&javascript, 9, true).unwrap().into_result()), Err(js_abi::JsValue::String(String::from("JS"))));
    let (direct, direct_cost) = measure(|| complete(borrowed_javascript((&text,)).unwrap().into_result()));
    let (bridged, bridge_cost) = measure(|| {
        let pending: js_abi::JsPromise<&str> = ${borrowedJsName}::invoke(&borrowed_javascript, &text).unwrap();
        complete(pending.into_result())
    });
    assert_eq!(direct, Ok(text.as_str()));
    assert_eq!(bridged, direct);
    assert_eq!(bridge_cost, direct_cost);
    assert!(core::ptr::eq(bridged.unwrap().as_ptr(), text.as_ptr()));
    println!("PASS: exact producer errors, lifetimes, optional mixed futures, JS Promise identity and zero bridge allocations");
}

#[cfg(pure_without_normalization)]
fn invalid() { let _ = ${ordinaryName}::invoke(&|(value,): (u64,)| value, 7); }

#[cfg(pure_future_without_normalization)]
fn invalid() { let _ = ${asyncName}::invoke(&|(value,): (u64,)| Ok::<_, Infallible>(async move { value }), 7); }

#[cfg(wrong_error)]
fn invalid() { let _: Result<u64, bool> = ${ordinaryName}::invoke(&|(value,): (u64,)| Ok::<_, Infallible>(value), 7); }

#[cfg(borrow_escape)]
fn invalid() -> &'static str {
    let value = String::from("cannot escape");
    complete(${borrowName}::invoke(&borrowing, &value, 0).unwrap()).unwrap()
}

#[cfg(overlapping_implementation)]
struct Conflicting;
#[cfg(overlapping_implementation)]
impl rt::CallableImplementation<(u64,)> for Conflicting {
    type Output = Result<u64, Infallible>;
    fn invoke(&self, (value,): (u64,)) -> Self::Output { Ok(value) }
}
#[cfg(overlapping_implementation)]
impl ${ordinaryName} for Conflicting {
    type InvocationError = Infallible;
    fn invoke(&self, value: u64) -> Result<u64, Infallible> { Ok(value) }
}

#[cfg(environment_escape)]
fn invalid() -> &'static str {
    let value = String::from("cannot escape");
    let borrowed = value.as_str();
    complete(${pendingEnvironmentName}::invoke(&pending_environment, &borrowed).unwrap()).unwrap()
}

#[cfg(javascript_borrow_escape)]
fn invalid() -> &'static str {
    let value = String::from("cannot escape");
    complete(${borrowedJsName}::invoke(&borrowed_javascript, &value).unwrap().into_result()).unwrap()
}
`;
}

test("emitted producer bridges execute with exact physical channels and preserve native rejection", { timeout: 300_000 }, () => {
  const controls = ["pure_without_normalization", "pure_future_without_normalization", "wrong_error", "borrow_escape",
    "overlapping_implementation", "environment_escape", "javascript_borrow_escape"];
  const project = writeGeneratedProject("native-producer-bridges", [
    { path: "Cargo.toml", text: `[package]\nname = "native_producer_bridges"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]
tsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }
tsonic_rust_js = { path = ${JSON.stringify(javascript)} }
[patch.crates-io]
tsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }
[lints.rust]
unexpected_cfgs = { level = "deny", check-cfg = [${controls.map(control => JSON.stringify(`cfg(${control})`)).join(", ")}] }
` },
  ]);
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src/main.rs"), fixtureSource(project));
  runCargo(project, ["generate-lockfile", "--offline"]);
  const built = runCargo(project, ["rustc", "--offline", "--locked", "--", "-D", "warnings"]);
  assert.equal(built.status, 0);
  const executed = runCargo(project, ["run", "--offline", "--locked", "--quiet"]);
  assert.match(executed.stdout, /PASS: exact producer errors/u);
  for (const [control, code] of [
    ["pure_without_normalization", "E0271"], ["pure_future_without_normalization", "E0271"],
    ["wrong_error", "E0308"], ["borrow_escape", "E0515"], ["overlapping_implementation", "E0119"],
    ["environment_escape", "E0515"], ["javascript_borrow_escape", "E0515"],
  ]) {
    const rejected = spawnGeneratedCargo(project, ["rustc", "--offline", "--locked", "--message-format=json", "--", "--emit=metadata", "--cfg", control], {
      cwd: project, encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576,
    });
    assert.equal(rejected.error === undefined, true, `${control}: child completed`);
    assert.notEqual(rejected.status, 0, `${control}: must reject`);
    const diagnostics = rejected.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line))
      .filter(event => event.reason === "compiler-message").map(event => event.message);
    assert.equal(diagnostics.some(diagnostic => diagnostic.code?.code === code), true,
      `${control}: ${diagnostics.map(diagnostic => diagnostic.code?.code ?? diagnostic.message).join("; ")}`);
  }
});
