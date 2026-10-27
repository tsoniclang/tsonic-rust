import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeMethods, nativeType,
  nativeBorrow, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("generated cargo binary proves node provider rows at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r5_node_proof" } },
    files: {
      "index.ts": `
import { join, dirname, basename, extname, isAbsolute } from "node:path";
import { platform } from "node:os";
import { format } from "node:util";
import { check } from "@acme/testing";

export function main(): void {
  const full: string = join("/tmp", "dir", "file.txt");
  check(full === "/tmp/dir/file.txt");
  check(dirname(full) === "/tmp/dir");
  check(basename(full) === "file.txt");
  check(extname(full) === ".txt");
  check(isAbsolute(full));
  check(!isAbsolute("relative.txt"));
  check(platform().length > 0);
  const label = "count";
  check(format("%s:%d", label, 3) === "count:3");
  check(label === "count");
  check(format("%s") === "%s");
  const parsed = JSON.parse('{"ok":true}');
  check(format("%j", parsed) === '{"ok":true}');
  check(format("%j", JSON.parse('{"fresh":true}')) === '{"fresh":true}');
  check(format("%j %j", parsed, parsed) === '{"ok":true} {"ok":true}');
  JSON.stringify(parsed);
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /JsValue::from\(label\.clone\(\)\)/u);
  const main = nativeFunction(result, "main");
  const errorType = { kind: "named", path: "crate::index::NativeErrors3",
    identity: "native-error-join:/src/index.ts:3", genericArguments: [
      { kind: "type", type: { kind: "named", path: "rt::TsonicError", identity: "tsonic-rust-runtime:TsonicError" } },
      { kind: "type", type: { kind: "named", path: "rt::JsError" } },
      { kind: "type", type: { kind: "named", path: "tsonic_rust_node::NodeError", identity: "rust.node.NodeError" } },
    ] };
  assert.deepEqual(main.errorType, errorType, "the program retains every exact native error channel");
  const formats = nativeCalls(main.body, "tsonic_rust_node::util::format");
  assert.equal(formats.length, 5);
  const borrowed = formats.filter(call => call.args[1]?.kind === "call" &&
    call.args[1].path === "core::slice::from_ref");
  assert.equal(borrowed.length, 1, "the single retained JsValue is borrowed without a temporary array or clone");
  assert.deepEqual(borrowed[0].args, [{ kind: "str-literal", value: "%j" }, {
    kind: "call", path: "core::slice::from_ref", args: [{ kind: "reference", expr: { kind: "path", path: "parsed" } }],
  }]);
  const propagated = nativeNodes(main.body, node => node.kind === "try" &&
    node.expr.kind === "method-call" && node.expr.receiver === borrowed[0]);
  assert.equal(propagated.length, 1, "the exact format Result propagates once");
  const mapping = propagated[0].expr;
  assert.equal(mapping.method, "map_err");
  assert.deepEqual(mapping.genericArguments, [{ kind: "type", type: errorType }, { kind: "type", type: { kind: "infer" } }]);
  assert.deepEqual(mapping.args, [{ kind: "associated-value", owner: errorType, name: "Error2" }],
  "the selected NodeError enters its native arm directly, without a local TsonicError conversion");
  assert.deepEqual(propagated[0].operandErrorType, errorType);
  assert.deepEqual(propagated[0].resultErrorType, errorType);
  const stringify = nativeCalls(main.body, "js_abi::json_stringify");
  assert.equal(stringify.length, 1);
  assert.deepEqual(stringify[0].args, [{ kind: "reference", expr: { kind: "path", path: "parsed" } }]);
  const local = nativeNodes(main.body, node => node.kind === "try" &&
    node.expr.kind === "method-call" && node.expr.receiver === stringify[0]);
  assert.equal(local.length, 1);
  assert.equal(local[0].expr.method, "map_err");
  assert.deepEqual(local[0].expr.args, [{ kind: "associated-value", owner: errorType, name: "Error0" }]);
  assert.deepEqual(local[0].resultErrorType, errorType);
  const run = validateGeneratedProject("node-provider-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("node HTTP and timers lower through exact provider evidence and activate the event loop", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "node_server_contract" } },
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setInterval } from "node:timers";
import type { int32 } from "@tsonic/core/types.js";

function send(response: ServerResponse, statusCode: int32): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/octet-stream");
  const body = Buffer.from("ok", "utf8");
  response.end(body);
}

function handle(_request: IncomingMessage, response: ServerResponse): void {
  const okStatus: int32 = 200;
  send(response, okStatus);
}

export function main(): void {
  const port: int32 = 0;
  setInterval((): void => {
    JSON.parse("{}");
  }, 250 as int32);
  const aliasedHandle = handle;
  const server = createServer((aliasedHandle));
  server.listen(port, "127.0.0.1", (): void => {});
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const main = nativeFunction(result, "main");
  const servers = nativeCalls(main.body, "tsonic_rust_node::http::create_server_optional");
  assert.equal(servers.length, 1);
  assert.equal(servers[0].args.length, 3);
  nativeDispatchBinding(result, main.body, servers[0], servers[0].args[0].path, "tsonic_rust_node::http::HttpServers");
  const tasks = servers[0].args[1];
  assert.equal(tasks.kind, "method-call");
  assert.equal(tasks.method, "handle");
  assert.deepEqual(tasks.args, []);
  nativeDispatchBinding(result, main.body, servers[0], tasks.receiver.path, "tsonic_rust_node::runtime_tasks::RuntimeTasks");
  assert.deepEqual(servers[0].args[2], { kind: "call", path: "Some", args: [{ kind: "path", path: "aliasedHandle" }] });
  assert.equal(nativeFunction(result, "handle").errorType.identity, "tsonic-rust-runtime:TsonicError");
  const send = nativeFunction(result, "send");
  for (const method of ["set_status_code", "set_header", "end_buffer"]) {
    const calls = nativeMethods(send.body, method);
    assert.equal(calls.length, 1, `the exact response ${method} row is retained`);
    assert.equal(calls[0].receiver.path, "response");
  }
  assert.equal(nativeMethods(main.body, "listen_optional").length, 1);
  const timers = nativeCalls(main.body, "tsonic_rust_node::timers::set_interval_callable");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].args.length, 3);
  const callables = nativeNodes(timers[0].args[1], node => node.kind === "associated-call" &&
    node.owner.path === "rt::Callable" && node.method === "new");
  assert.equal(callables.length, 1, "the exact timer callback retains one native callable owner");
  const callableTypes = callables[0].owner.genericArguments.filter(argument => argument.kind === "type").map(argument => argument.type);
  assert.deepEqual(callableTypes[0], nativeType("()"));
  assert.equal(callableTypes[1].path, "Result");
  assert.deepEqual(callableTypes[1].genericArguments[0].type, nativeType("()"));
  assert.equal(callableTypes[1].genericArguments[1].type.identity, "tsonic-rust-runtime:TsonicError",
    "the timer callback keeps the same exact fallible unit ABI, independent of Result alias spelling");
  // The Node provider declares its binary hook as run_entry_with_contexts (rust-nodejs nodejs/src/provider/package.ts).
  assert.equal(nativeCalls(nativeFunction(result, "main", "src/main.rs"), "tsonic_rust_node::run_entry_with_contexts").length,
    1, "the selected providers activate the Node event loop");
  validateGeneratedProject("node-server-contract", result.artifacts);
});
