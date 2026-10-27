import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { generatedCargoOptions } from "../../helpers/cargo-target-pool.mjs";
import { realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeClosureProducerFixture, printNativeClosureProducer, nativeClosureProducerFailurePackage }
  from "../../helpers/native-closure-producers.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustCallableConstructionType } from "../../../dist/backend/planner/types/constructions.js";
import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustRuntimeCallableTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustNativeCompletionFutureType } from "../../../dist/target-model/types/callable-completions.js";
import { rustTypeGenericArguments } from "../../../dist/target-model/types/generic-arguments.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workspace = dirname(realpathSync(resolve(repository, "../tsonic")));
const runtime = resolve(workspace, "rust-runtime/crates/tsonic_rust_runtime");
const javascript = resolve(workspace, "rust-js/crates/tsonic_rust_js");
const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", []);
const promiseFailure = rustNamedTargetType("fixture:PromiseFailure", "PromiseFailure", []);

function fixtureSource(projectRoot) {
  const pureFixture = nativeClosureProducerFixture();
  const pure = printNativeClosureProducer(pureFixture);
  const throws = printNativeClosureProducer(nativeClosureProducerFixture({
    packages: [nativeClosureProducerFailurePackage(failure)], source: `
import { fail } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => int32 { return (): int32 => fail(); }
`,
    body: context => ({ kind: "try", expr: { kind: "call", path: "fail", args: [] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType }),
  }));
  const settled = printNativeClosureProducer(nativeClosureProducerFixture({ asynchronous: true, surfaces: ["js"] }));
  const pending = printNativeClosureProducer(nativeClosureProducerFixture({ asynchronous: true, surfaces: ["js"], source: `
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => Promise<int32> { return async (): Promise<int32> => await Promise.resolve(3); }
`, body: context => ({ kind: "try", expr: { kind: "await", expr: { kind: "method-call",
    receiver: { kind: "call", path: "js_abi::JsPromise::resolved", args: [{ kind: "int-literal", text: "3" }] },
    method: "into_result", args: [] } }, operandErrorType: context.fallibleBoundary.errorType,
    resultErrorType: context.fallibleBoundary.errorType }),
  }));
  const rejected = printNativeClosureProducer(nativeClosureProducerFixture({ asynchronous: true, surfaces: ["js"],
    packages: [nativeClosureProducerFailurePackage(rustJsValueTargetType(), { path: "reject" })], source: `
import { fail as reject } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => Promise<int32> { return async (): Promise<int32> => reject(); }
`,
    body: context => ({ kind: "try", expr: { kind: "call", path: "reject", args: [] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType }),
  }));
  const nativeRejected = printNativeClosureProducer(nativeClosureProducerFixture({ asynchronous: true,
    packages: [nativeClosureProducerFailurePackage(promiseFailure, { path: "reject_native" })], source: `
import { fail as reject_native } from "test:producer";
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => Promise<int32> { return async (): Promise<int32> => reject_native(); }
`, body: context => ({ kind: "try", expr: { kind: "call", path: "reject_native", args: [] },
    operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType }),
  }));
  const integer = rustSourcePrimitiveTargetType("int32");
  const infallible = rustNamedTargetType("rust.core.Infallible", "core::convert::Infallible", []);
  const future = rustNativeCompletionFutureType({ identity: "fixture:future", output: integer, error: failure, captures: [] });
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future, infallible]));
  const carrier = rustRuntimeCallableTargetType({ kind: "static" }, [], result);
  const owner = rustCallableConstructionType(carrier, pureFixture.context);
  assert.equal(owner !== undefined, true, "anonymous constructor payload is representable");
  const constructor = printRustExpr({ kind: "associated-call", owner, method: "new", args: [{
    kind: "closure", params: [{ name: "_arguments", byRefCopy: false, type: { kind: "unit" } }], move: true,
    body: { kind: "call", path: "Ok", genericArguments: [{ kind: "type", type: { kind: "infer" } },
      { kind: "type", type: { kind: "named", path: "Infallible" } }], args: [{
      kind: "async-block", move: true,
      body: { statements: [{ kind: "tail", expr: { kind: "call", path: "fail", args: [] } }] },
    }] },
  }] });
  assert.doesNotMatch([pure, throws, settled, pending, rejected, nativeRejected, constructor].join("\n"),
    /ConsumerFailure|TsonicError|TsonicResult|Box::|\.clone\(/u);
  return `
use tsonic_rust_runtime as rt;
use tsonic_rust_js::abi as js_abi;
use core::convert::Infallible;

${nativeOwnershipCostSupport(projectRoot)}

#[derive(Debug, PartialEq, Eq)]
struct ProducerFailure(core::marker::PhantomPinned);
#[derive(Clone, Debug, PartialEq, Eq)]
struct PromiseFailure;

fn fail() -> Result<i32, ProducerFailure> { Err(ProducerFailure(core::marker::PhantomPinned)) }
fn reject() -> Result<i32, js_abi::JsValue> { Err(js_abi::JsValue::String(String::from("promise"))) }
fn reject_native() -> Result<i32, PromiseFailure> { Err(PromiseFailure) }
fn complete<Value>(future: impl core::future::Future<Output = Value>) -> Value {
    let mut future = core::pin::pin!(future);
    match future.as_mut().poll(&mut core::task::Context::from_waker(core::task::Waker::noop())) {
        core::task::Poll::Ready(value) => value,
        core::task::Poll::Pending => panic!("fixture future did not complete"),
    }
}

fn main() {
    let (pure, generated_cost) = measure(|| ${pure});
    let (direct, direct_cost) = measure(|| rt::Callable::new(|(): ()| Ok::<_, Infallible>(3i32)));
    assert_eq!(generated_cost, direct_cost);
    let (result, invoke_cost) = measure(|| pure.call(()));
    assert_eq!(result, Ok(3));
    assert_eq!(direct.call(()), result);
    assert_eq!(invoke_cost, Cost::default());

    let throwing = ${throws};
    let (result, invoke_cost) = measure(|| throwing.call(()));
    assert_eq!(result, Err(ProducerFailure(core::marker::PhantomPinned)));
    assert_eq!(invoke_cost, Cost::default());

    tsonic_rust_js::event_loop::block_on(async {
        let settled = ${settled};
        let (result, generated_cost) = measure(|| complete(settled.call(()).unwrap().into_result()));
        let (direct, direct_cost) = measure(|| complete(js_abi::JsPromise::resolved(3i32).into_result()));
        assert_eq!(result, Ok(3));
        assert_eq!(result, direct);
        assert_eq!(generated_cost, direct_cost);

        let pending = ${pending};
        let (result, generated_cost) = measure(|| complete(pending.call(()).unwrap().into_result()));
        let (direct, direct_cost) = measure(|| complete(js_abi::JsPromise::from_fallible_factory(move || async move {
            js_abi::JsPromise::resolved(3i32).into_result().await
        }).into_result()));
        assert_eq!(result, Ok(3));
        assert_eq!(result, direct);
        assert_eq!(generated_cost, direct_cost);

        let rejected = ${rejected};
        assert_eq!(complete(rejected.call(()).unwrap().into_result()), Err(js_abi::JsValue::String(String::from("promise"))));
    }).unwrap();
    let native_rejected = ${nativeRejected};
    assert_eq!(complete(native_rejected.call(()).unwrap()), Err(PromiseFailure));
    let native = ${constructor};
    let (result, future_cost) = measure(|| complete(native.call(()).unwrap()));
    assert_eq!(result, Err(ProducerFailure(core::marker::PhantomPinned)));
    assert_eq!(future_cost, Cost::default());
    println!("PASS: producer-owned closure errors, suspended separation and native allocation parity");
}

#[cfg(wrong_invocation_error)]
fn invalid() { let _: rt::Callable<'_, (), Result<i32, ProducerFailure>> = ${pure}; }

#[cfg(wrong_suspension_error)]
fn invalid() {
    let selected = ${nativeRejected};
    let _: Result<i32, ProducerFailure> = complete(selected.call(()).unwrap());
}

#[cfg(wrong_js_rejection)]
fn invalid() {
    let selected = ${rejected};
    let _: Result<i32, PromiseFailure> = complete(selected.call(()).unwrap().into_result());
}
`;
}

test("closure emission executes exact owned errors without added allocation or error Clone bounds", { timeout: 300_000 }, () => {
  const controls = ["wrong_invocation_error", "wrong_suspension_error", "wrong_js_rejection"];
  const project = writeGeneratedProject("native-closure-producers", [
    { path: "Cargo.toml", text: `[package]\nname = "native_closure_producers"\nversion = "0.0.0"\nedition = "2024"\n
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
  runCargo(project, ["rustc", "--offline", "--locked", "--", "-D", "warnings"]);
  assert.match(runCargo(project, ["run", "--offline", "--locked", "--quiet"]).stdout, /PASS: producer-owned closure errors/u);
  for (const control of controls) {
    const rejected = spawnSync("cargo", ["rustc", "--offline", "--locked", "--message-format=json", "--", "--emit=metadata", "--cfg", control], generatedCargoOptions(project, ["rustc"], {
      cwd: project, encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576,
    }));
    assert.equal(rejected.signal, null, control);
    assert.equal(rejected.status !== 0, true, control);
    const messages = rejected.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    assert.equal(messages.some(message => message.reason === "compiler-message" && message.message.code?.code === "E0308"),
      true, `${control}: native Rust rejects the wrong exact error channel`);
  }
});
