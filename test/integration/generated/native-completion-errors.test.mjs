import assert from "node:assert/strict";
import test from "node:test";
import { lowerRustCompletionScope } from "../../../dist/backend/target-ast/normalization/completion-regions.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustRuntimeCratePath } from "../../helpers/rust-session-paths.mjs";

const path = name => ({ kind: "path", path: name });
const callMethod = (receiver, method, args = []) => ({ kind: "method-call", receiver: path(receiver), method, args });
const errorType = { kind: "qualified", owner: { kind: "named", path: "Producer" },
  trait: { kind: "named", path: "callback::Invoke" }, member: "Error" };

function completionFunction(asynchronous) {
  const scope = { kind: "try-scope", bodyName: "body_flow", flowName: "flow", finallyName: "finally_flow",
    dispatchResultWrapped: true,
    returnType: { kind: "unit" }, errorType, bodyErrorType: errorType, asynchronous,
    body: { statements: [{ kind: "expr", expr: { kind: "try", expr: callMethod("producer", "invoke"),
      operandErrorType: errorType, resultErrorType: errorType } }] }, bodyTerminates: false,
    finallyClause: { errorType: undefined, terminates: false, body: { statements: [{ kind: "expr",
      expr: callMethod("finalized", "set", [{ kind: "binary", operator: "+", left: callMethod("finalized", "get"),
        right: { kind: "int-literal", text: "1" } }]) }] } },
    propagate: false, dispatchReturn: false, dispatchTargets: [], terminates: false };
  const normalized = finalizeRustSourceStyle({ headerComment: "exact native completion", items: [{
    kind: "function", name: asynchronous ? "async_complete" : "sync_complete", visibility: "private", isAsync: asynchronous,
    returnType: { kind: "unit" }, errorType,
    params: [
      { name: "producer", type: { kind: "reference", mutable: true, referent: { kind: "named", path: "Producer" } } },
      { name: "finalized", type: { kind: "reference", mutable: false, referent: { kind: "named", path: "core::cell::Cell",
        genericArguments: [{ kind: "type", type: { kind: "primitive", name: "u32" } }] } } },
    ],
    generics: { parameters: [{ kind: "type", name: "Producer", bounds: [{ kind: "trait", path: "callback::Invoke" }] }], wherePredicates: [] },
    body: { statements: [lowerRustCompletionScope(scope),
      { kind: "tail", expr: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } }] },
  }] });
  return printRustSourceFile(normalized);
}

test("native completion errors execute for generic associated non-Clone borrows on core-only runtime", { timeout: 300_000 }, () => {
  const syncBody = completionFunction(false);
  const asyncBody = completionFunction(true);
  for (const body of [syncBody, asyncBody]) {
    assert.match(body, /<Producer as callback::Invoke>::Error/u);
    assert.doesNotMatch(body, /TsonicError|TsonicResult|::from\(|\.clone\(|Default|Box|dyn |'static/u);
  }
  const source = `use tsonic_rust_runtime as rt;
mod callback {
    pub trait Invoke {
        type Error;
        fn invoke(&mut self) -> Result<(), Self::Error>;
    }
}
${syncBody}
${asyncBody}
struct BorrowedError<'scope>(&'scope mut u32);
struct Failure<'scope>(Option<&'scope mut u32>);
impl<'scope> callback::Invoke for Failure<'scope> {
    type Error = BorrowedError<'scope>;
    fn invoke(&mut self) -> Result<(), Self::Error> {
        Err(BorrowedError(self.0.take().expect("one invocation")))
    }
}
struct Success;
impl callback::Invoke for Success {
    type Error = core::convert::Infallible;
    fn invoke(&mut self) -> Result<(), Self::Error> { Ok(()) }
}
fn ready<Output>(future: impl std::future::Future<Output = Output>) -> Output {
    match std::pin::pin!(future).as_mut().poll(&mut std::task::Context::from_waker(std::task::Waker::noop())) {
        std::task::Poll::Ready(value) => value,
        std::task::Poll::Pending => panic!("unexpected suspension"),
    }
}
fn main() {
    let finalized = core::cell::Cell::new(0);
    for asynchronous in [false, true] {
        let mut value = 7;
        let original = std::ptr::from_ref(&value);
        let mut callback = Failure(Some(&mut value));
        let outcome = if asynchronous { ready(async_complete(&mut callback, &finalized)) }
            else { sync_complete(&mut callback, &finalized) };
        match outcome {
            Err(error) => { assert_eq!(std::ptr::from_ref(&*error.0), original); *error.0 = 9; }
            Ok(()) => panic!("native error lost"),
        }
        assert_eq!(value, 9);
    }
    assert_eq!(finalized.get(), 2);
    let mut pure = Success;
    assert_eq!(sync_complete(&mut pure, &finalized), Ok(()));
    assert_eq!(ready(async_complete(&mut pure, &finalized)), Ok(()));
    assert_eq!(finalized.get(), 4);
}
`;
  const project = writeGeneratedProject("native-completion-errors", [
    { path: "Cargo.toml", text: `[package]\nname = "native_completion_errors"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]\ntsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)}, default-features = false }\n` },
    { path: "src/main.rs", text: source },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
});
