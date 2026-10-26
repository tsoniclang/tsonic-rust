import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeMethods, nativeType,
  nativeBorrow, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("node path and os lower through provider rows to tsonic_rust_node", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { join, dirname, basename, extname, isAbsolute } from "node:path";
import { platform, eol } from "node:os";

export function probe(dir: string, file: string): boolean {
  const full: string = join(dir, file);
  const parent: string = dirname(full);
  const name: string = basename(full);
  const ext: string = extname(name);
  return isAbsolute(full) && parent.length >= 0 && platform().length > 0 && eol().length > 0 && ext.length >= 0;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.doesNotMatch(text, /use tsonic_rust_node::path as node_path;/u);
  assert.match(text, /pub fn probe\(dir: String, file: String\)/u);
  assert.match(text, /tsonic_rust_node::path::join\(&\[dir\.as_str\(\), file\.as_str\(\)\]\)/u);
  assert.match(text, /tsonic_rust_node::path::dirname\(&full\)/u);
  assert.match(text, /tsonic_rust_node::path::basename\(&full, None\)/u);
  assert.match(text, /tsonic_rust_node::os::platform\(\)/u);
  assert.match(text, /tsonic_rust_node::os::eol\(\)/u);
  assert.doesNotMatch(text, /tsonic_rust_node::os::eol\(\)\.to_string\(\)/u);
  assert.match(artifactText(result, "Cargo.toml"), /tsonic_rust_node = \{ path = ".*rust-nodejs\/rust\/crates\/tsonic_rust_node" \}/u);
});

test("writable provider projections lower through their exact selected write evidence", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import process from "node:process";

export function setExitStatus(): void {
  process.exitCode = 2;
  process.exitCode = null;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::process::set_exit_code\(Some\(2\)\)/u);
  assert.match(text, /tsonic_rust_node::process::set_exit_code\(Option::<i32>::None\)/u);
});

test("provider argument conversion does not change nested source operator semantics", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import type { int32 } from "@tsonic/core/types.js";

export function readOffset(bytes: Buffer): int32 {
  let index = 2;
  return bytes.readUInt8(index + 1);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /read_uint8_number\(\s*&bytes,\s*index \+ 1\.0,?\s*\)/u);
  assert.match(text, /u8_to_i32\([\s\S]*read_uint8_number/u);
  assert.doesNotMatch(text, /f64_to_i32/u);
});

test("node path, filesystem, and crypto overloads lower through exact provider signatures", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, sep } from "node:path";

export function probe(
  root: string,
  bytes: Buffer,
  mode: number,
  maxRetries: number,
  retryDelay: number,
): string {
  const temporary = mkdtempSync(root);
  mkdirSync(temporary, { recursive: true, mode });
  const separator = sep;
  const file = temporary + separator + "payload.bin";
  writeFileSync(file, bytes);
  const loaded = readFileSync(file);
  const digest = createHash("sha256").update(loaded).digest("hex");
  const textFile = temporary + separator + "payload.txt";
  writeFileSync(textFile, "hello", "utf8");
  const text = readFileSync(textFile, "utf8");
  const symbolic = lstatSync(file).isSymbolicLink();
  const relativePath = relative(temporary, file);
  const result = text + digest;
  rmSync(temporary, { recursive: true, force: true, maxRetries, retryDelay });
  if (symbolic) return relativePath;
  return result;
}

export function defaultedOptions(path: string): void {
  mkdirSync(path, { recursive: true });
  rmSync(path, { recursive: true, force: true });
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::path::relative/u);
  assert.match(text, /String::from\(tsonic_rust_node::path::sep\(\)\)/u);
  assert.match(text, /tsonic_rust_node::fs::read_file_sync_buffer/u);
  assert.match(text, /tsonic_rust_node::fs::read_file_sync_string/u);
  assert.match(text, /tsonic_rust_node::fs::write_file_sync_buffer/u);
  assert.match(text, /tsonic_rust_node::fs::write_file_sync_string/u);
  assert.match(text, /\.update_buffer_owned\(/u);
  assert.match(text, /\.digest_string\(/u);
  assert.match(text, /\.is_symbolic_link\(\)/u);
  assert.match(
    text,
    /MakeDirectoryOptions\s*\{\s*recursive:\s*Some\(true\),\s*mode:\s*Some\(rt::conversions::checked_integer::<u32>\(mode\)\?\),\s*\}/u,
  );
  assert.match(
    text,
    /RmOptions\s*\{\s*recursive:\s*Some\(true\),\s*force:\s*Some\(true\),\s*max_retries:\s*Some\(rt::conversions::checked_integer::<u32>\(maxRetries\)\?\),\s*retry_delay_ms:\s*Some\(rt::conversions::checked_integer::<u64>\(retryDelay\)\?\),\s*\}/u,
  );
  assert.match(
    text,
    /MakeDirectoryOptions\s*\{\s*recursive:\s*Some\(true\),\s*\.\.Default::default\(\)\s*\}/u,
  );
  assert.match(
    text,
    /RmOptions\s*\{\s*recursive:\s*Some\(true\),\s*force:\s*Some\(true\),\s*\.\.Default::default\(\)\s*\}/u,
  );
  validateGeneratedProject("node-portable-contracts", result.artifacts);
});

test("provider-private boolean filesystem overloads are absent", async () => {
  const diagnostics = rustSourceDiagnostics(createRustSession({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { mkdirSync, rmSync } from "node:fs";

export function invalid(path: string): void {
  mkdirSync(path, true);
  rmSync(path, true);
}
`,
    },
  }));

  assert.equal([...diagnostics.matchAll(/TS2769/gu)].length, 2);
});

test("borrowed provider strings materialize ownership only in owned contexts", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "index.ts": `
import { sep } from "node:path";

export function ownedSeparator(): string {
  return sep;
}

export function endsWithSeparator(value: string): boolean {
  return value.endsWith(sep);
}

export function appendSeparator(value: string): string {
  return value + sep;
}

export function main(): void {
  const separator = ownedSeparator();
  const appended = appendSeparator("path");
  if (separator !== sep || appended !== "path" + separator || !endsWithSeparator(appended) || endsWithSeparator("path")) {
    throw new Error("borrowed separator contract");
  }
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const owned = nativeFunction(result, "ownedSeparator");
  assert.deepEqual(owned.returnType, nativeType("String"));
  const conversions = nativeNodes(owned.body, node => node.kind === "owned-string-from-borrowed-str" &&
    nativeCalls(node.expression, "tsonic_rust_node::path::sep").length === 1);
  assert.equal(conversions.length, 1, "ownership is materialized exactly at the owned result boundary");
  const ends = nativeFunction(result, "endsWithSeparator");
  const comparisons = nativeCalls(ends.body, "js_string::ends_with_at_end");
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].args[0].path, "core::convert::AsRef::<str>::as_ref");
  assert.equal(nativeCalls(comparisons[0].args[1], "tsonic_rust_node::path::sep").length, 1);
  assertNoNativeCalls(ends.body, ["to_owned", "to_string", "clone"], "read-only native separator stays borrowed");
  const append = nativeFunction(result, "appendSeparator");
  const parts = nativeNodes(append.body, node => node.kind === "string-concat");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].parts.length, 2);
  assert.equal(parts[0].parts[0].path, "value");
  assert.equal(nativeCalls(parts[0].parts[1], "tsonic_rust_node::path::sep").length, 1);
  assertNoNativeCalls(append.body, ["to_string"], "native concatenation does not materialize a separate separator");
  validateGeneratedProject("node-borrowed-provider-strings", result.artifacts, { run: true });
});

test("node assert.ok overloads lower through exact selected signatures", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { ok } from "node:assert";

function sumIsFour(left: number, right: number): boolean {
  return left + right === 4;
}

export function verify(value: boolean): void {
  ok(value);
  ok(value, "value must be true");
  ok(sumIsFour(2, 2), "nested operations must be finalized");
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::assert::ok\(value, None\)\?/u);
  assert.match(text, /tsonic_rust_node::assert::ok_with_message\(value, "value must be true"\)\?/u);
  assert.match(
    text,
    /tsonic_rust_node::assert::ok_with_message\(\s*sumIsFour\(2\.0, 2\.0\),\s*"nested operations must be finalized",\s*\)\?/u,
  );
});

test("node util.format lowers fixed and variadic arguments through one value-slice ABI", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "index.ts": `
import { format } from "node:util";

export function render(label: string, count: number, ok: boolean): string {
  const output = format("%s:%d:%s", label, count, ok);
  return output + label + format("%s");
}

export function main(): void {
  if (render("count", 3, true) !== "count:3:truecount%s") throw new Error("native format contract");
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(
    text,
    /tsonic_rust_node::util::format\(\s*"%s:%d:%s",\s*&\[\s*js_abi::JsValue::from\(label\.clone\(\)\),\s*js_abi::JsValue::from\(count\),\s*js_abi::JsValue::from\(ok\),\s*\]\s*,?\s*\)/su,
  );
  assert.match(text, /tsonic_rust_node::util::format\("%s", &\[\]\)/u);
  assert.match(
    text,
    /\[\s*core::convert::AsRef::<str>::as_ref\(&output\),\s*core::convert::AsRef::<str>::as_ref\(&label\),\s*core::convert::AsRef::<str>::as_ref\(&tsonic_rust_node::util::format\("%s", &\[\]\)\?\),\s*\]\s*\.concat\(\)/u,
  );
  validateGeneratedProject("node-util-native-format", result.artifacts, { run: true });
});

test("filesystem watchers lower through exact selected provider evidence", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { watch } from "node:fs";

export function observe(path: string): void {
  const watcher = watch(path);
  watcher.unref();
  watcher.ref();
  watcher.close();
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::fs::watch(&path)?/u);
  assert.match(source, /watcher\.unref\(\)/u);
  assert.match(source, /watcher\.ref_\(\)/u);
  assert.match(source, /watcher\.close\(\)/u);
});

test("node package is a target capability independent of the js source surface", async () => {
  const capability = await nodejsCapability();
  assert.equal(capability.kind, "target-capability");
  assert.equal(capability.targetId, "rust");
  assert.equal(Object.hasOwn(capability, "requiredSurfaces"), false);
  assert.deepEqual(capability.moduleOwnership.map((entry) => entry.specifierPrefix ?? entry.moduleSpecifier).length > 0, true);
});

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

test("required Node event, stream, DNS, compression, net, and readline families lower together", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { lookup } from "node:dns";
import { EventEmitter } from "node:events";
import { createConnection, isIP } from "node:net";
import { createInterface, type ReadLineOptions } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { gzipSync } from "node:zlib";

export function exerciseNodeFamilies(
  emitter: EventEmitter,
  readable: Readable,
  writable: Writable,
  payload: Buffer,
  options: ReadLineOptions,
  host: string,
  port: number,
): boolean {
  const listener = (value: any): void => {
    JSON.stringify(value);
  };
  emitter.on("data", listener);
  const emitted = emitter.emit("data", payload);
  emitter.off("data", listener);

  readable.pause().resume().pipe(writable);
  writable.write(payload);
  writable.end("done");

  lookup(host, (_error: any, address: string, family: number): void => {
    JSON.stringify({ address, family });
  });
  const compressed = gzipSync(payload);
  const socket = createConnection(port, host);
  socket.write(compressed);
  socket.end();

  const lines = createInterface(options);
  lines.setPrompt("> ");
  lines.question("value? ", (answer: string): void => {
    JSON.stringify(answer);
  });
  lines.pause().resume();
  lines.prompt();
  lines.close();
  return emitted && isIP(host) !== 0;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /node_events::EventEmitter::new|emit_callable/u);
  assert.match(source, /\.pipe_to\(/u);
  assert.match(source, /tsonic_rust_node::dns::lookup_callable/u);
  assert.match(source, /tsonic_rust_node::zlib::gzip_sync/u);
  assert.match(source, /tsonic_rust_node::net::create_connection_source/u);
  assert.match(source, /tsonic_rust_node::readline::create_interface/u);
  validateGeneratedProject("node-required-families", result.artifacts);
});

test("required Node TLS, HTTPS, and module-worker families lower through closed artifacts", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "node_secure_worker_contract" } },
    files: {
      "index.ts": `
import { createServer as createHttpsServer, request, type ServerOptions as HttpsServerOptions } from "node:https";
import { connect, createServer as createTlsServer, type ConnectionOptions, type TlsOptions } from "node:tls";
import {
  isMarkedAsUntransferable,
  markAsUntransferable,
  MessageChannel,
  Worker,
} from "node:worker_threads";

export function secure(
  connection: ConnectionOptions,
  tlsOptions: TlsOptions,
  httpsOptions: HttpsServerOptions,
  port: number,
  host: string,
): void {
  const socket = connect(connection, (): void => {});
  socket.write("ping");
  socket.ref().unref();
  socket.end();

  const tlsServer = createTlsServer(tlsOptions, (peer): void => {
    peer.write("ready");
    peer.end();
  });
  tlsServer.listen(port, host, (): void => {});
  tlsServer.unref();
  tlsServer.close();

  const httpsServer = createHttpsServer(httpsOptions, (_incoming, response): void => {
    response.end("ok");
  });
  httpsServer.listen(port, host, (): void => {});
  httpsServer.unref();
  httpsServer.close();

  const outgoing = request("https://example.test/", (response): void => {
    response.read();
  });
  outgoing.write("body");
  outgoing.end();
}

export function workers(): void {
  const worker = new Worker("./worker.js", { name: "proof", argv: ["one"] });
  worker.on("message", (value: any): void => {
    JSON.stringify(value);
  });
  worker.postMessage({ ready: true });
  worker.ref().unref();
  worker.terminate();

  const channel = new MessageChannel();
  channel.port1.start();
  channel.port1.postMessage("message");
  channel.port1.unref();
  channel.port1.ref();
  channel.port1.close();

  const exact = { value: 1 };
  markAsUntransferable(exact);
  isMarkedAsUntransferable(exact);
}

export function main(): void {
  workers();
}
main();
`,
      "worker.ts": `
import { parentPort, workerData } from "node:worker_threads";

if (parentPort !== undefined) {
  parentPort.postMessage(workerData);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::tls::connect_callable/u);
  assert.match(source, /tsonic_rust_node::tls::create_server/u);
  assert.match(source, /tsonic_rust_node::https::create_server_callable/u);
  assert.match(source, /tsonic_rust_node::worker_threads::Worker::spawn_with_options/u);
  assert.match(artifactText(result, "src/main.rs"), /initialize_worker_process/u);
  validateGeneratedProject("node-secure-worker-contract", result.artifacts);
});

test("async third-party provider rows lower through the same generic infrastructure", async () => {
  const { acmeDbPackage } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeDbPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { connect } from "@acme/db";

export async function run_migration(path: string): Promise<int32> {
  const db = await connect(path);
  const first = await db.execute("create table items(id int)");
  const second = await db.execute("insert into items values (1)");
  return first + second;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn run_migration\(path: String\) -> i32/u);
  assert.match(text, /acme_db::connect\(path\)\.await/u);
  assert.doesNotMatch(text, /path\.clone\(\)/u);
  assert.match(text, /db\.execute\(String::from\("create table items\(id int\)"\)\)\.await/u);
  assert.match(artifactText(result, "Cargo.toml"), /acme_db = \{ path = /u);
});

test("generated cargo library proves the async provider lane compiles clean", { timeout: 300_000 }, async () => {
  const { acmeDbPackage } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeDbPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { connect } from "@acme/db";

export async function run_migration(path: string): Promise<int32> {
  const db = await connect(path);
  return await db.execute("create table items(id int)");
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("r5-async-provider-lib", result.artifacts);
});
