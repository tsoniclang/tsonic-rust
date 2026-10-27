import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeMethods, nativeType,
  nativeBorrow, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("retained provider callbacks preserve arbitrary first-class callable values", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export function register(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): void {
  createServer(handler);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const model = nativeSource(result);
  const aliases = model.items.filter(item => item.kind === "type-alias" && item.name === "RegisterHandler");
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].visibility, "public");
  assert.equal(aliases[0].target.path, "rt::Callable");
  const arguments_ = aliases[0].target.genericArguments.filter(argument => argument.kind === "type").map(argument => argument.type);
  assert.equal(arguments_[0].kind, "tuple");
  assert.deepEqual(arguments_[0].elements.map(type => type.path),
    ["tsonic_rust_node::http::IncomingMessage", "tsonic_rust_node::http::ServerResponse"]);
  assert.equal(arguments_[0].elements.every(type => type.genericArguments[0].type.identity === "tsonic-rust-runtime:TsonicError"), true);
  assert.equal(arguments_[1].path, "rt::TsonicResult");
  assert.deepEqual(arguments_[1].genericArguments[0].type, nativeType("()"));
  const register = nativeFunction(result, "register");
  assert.equal(register.visibility, "public");
  assert.deepEqual(register.params.map(parameter => parameter.type), [{ kind: "named", path: "RegisterHandler", genericArguments: [] }]);
  const servers = nativeCalls(register.body, "tsonic_rust_node::http::create_server_optional");
  assert.equal(servers.length, 1);
  assert.equal(servers[0].args.length, 3);
  assert.deepEqual(servers[0].args[2], { kind: "call", path: "Some", args: [{ kind: "path", path: "handler" }] });
  nativeDispatchBinding(result, register.body, servers[0], servers[0].args[0].path, "tsonic_rust_node::http::HttpServers");
  const tasks = servers[0].args[1];
  assert.equal(tasks.kind, "method-call");
  assert.equal(tasks.method, "handle");
  assert.deepEqual(tasks.args, []);
  nativeDispatchBinding(result, register.body, servers[0], tasks.receiver.path, "tsonic_rust_node::runtime_tasks::RuntimeTasks");
  assertNoNativeCalls(register.body, ["clone"], "the exact first-class handler is retained without a copy");
  validateGeneratedProject("node-retained-callback", result.artifacts);
});
