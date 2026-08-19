import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  nodejsCapability,
} from "../../helpers/rust-session.mjs";
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

  assert.deepEqual(result.diagnostics, []);
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

  assert.deepEqual(result.diagnostics, []);
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

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /read_uint8_number\(&bytes, index \+ 1\.0\)/u);
  assert.match(text, /f64_to_i32\([\s\S]*read_uint8_number/u);
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

export function probe(root: string, bytes: Buffer): string {
  const temporary = mkdtempSync(root);
  mkdirSync(temporary, true);
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
  rmSync(temporary, true);
  if (symbolic) return relativePath;
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
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
  validateGeneratedProject("node-portable-contracts", result.artifacts);
});

test("borrowed provider strings materialize ownership only in owned contexts", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn owned_separator\(\) -> String \{[\s\S]*String::from\(tsonic_rust_node::path::sep\(\)\)/u);
  assert.match(text, /ends_with_at_end\(value, tsonic_rust_node::path::sep\(\)\)/u);
  assert.match(text, /format!\("\{\}\{\}", value, tsonic_rust_node::path::sep\(\)\)/u);
  assert.doesNotMatch(text, /sep\(\)\.to_string\(\)/u);
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

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::assert::ok\(value, None\)\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /tsonic_rust_node::assert::ok_with_message\(value, "value must be true"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(
    text,
    /tsonic_rust_node::assert::ok_with_message\(\s*sum_is_four\(2\.0, 2\.0\),\s*"nested operations must be finalized",\s*\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u,
  );
});

test("node util.format lowers fixed and variadic arguments through one value-slice ABI", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { format } from "node:util";

export function render(label: string, count: number, ok: boolean): string {
  const output = format("%s:%d:%s", label, count, ok);
  return output + label + format("%s");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(
    text,
    /tsonic_rust_node::util::format\(\s*"%s:%d:%s",\s*&\[\s*tsonic_rust_js::abi::js_value_from_string\(&label\),\s*tsonic_rust_js::abi::JsValue::from\(count\),\s*tsonic_rust_js::abi::JsValue::from\(ok\),\s*\]\s*,?\s*\)/su,
  );
  assert.match(text, /tsonic_rust_node::util::format\("%s", &\[\]\)/u);
  assert.match(text, /format!\("\{\}\{\}\{\}", output, label, tsonic_rust_node::util::format\("%s", &\[\]\)\)/u);
});

test("declared-but-unsupported node APIs diagnose deterministically", async () => {
  const options = {
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { watch } from "node:fs";

export function observe(path: string): void {
  watch(path);
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
    message: "No Rust operation row matches selected provider declaration 'tsonic.rust.provider-package.@tsonic/rust-nodejs.binding::tsonic.rust.node.fs::node:fs::watch::node:fs::watch(...)' as method.",
  }]);
});

test("node package requires the js surface", async () => {
  const capability = await nodejsCapability();
  assert.equal(capability.kind, "target-capability");
  assert.equal(capability.targetId, "rust");
  assert.deepEqual(capability.requiredSurfaces, ["js"]);
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
  JSON.stringify(parsed);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_value_from_string\(&label\)/u);
  assert.match(text, /clone_js_value\(&parsed\)/u);
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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::http::create_server_callable/u);
  assert.match(source, /fn handle\([^)]*\) -> rt::TsonicResult<\(\)>/u);
  assert.match(source, /response\.set_status_code\(/u);
  assert.match(source, /response\n\s+\.set_header\(/u);
  assert.match(source, /response\.end_buffer\(/u);
  assert.match(source, /server\n\s+\.listen\(/u);
  assert.match(source, /tsonic_rust_node::timers::set_interval_callable/u);
  assert.match(source, /rt::Callable::<[^;]+rt::TsonicResult<\(\)>>/u);
  const main = artifactText(result, "src/main.rs");
  assert.match(main, /tsonic_rust_node::run_event_loop\(\)\?/u);
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

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /handler: rt::Callable<[\s\S]*?rt::TsonicResult<\(\)>,?\s*>/u);
  assert.match(source, /tsonic_rust_node::http::create_server_callable\(handler\.clone\(\)\)/u);
  validateGeneratedProject("node-retained-callback", result.artifacts);
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

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn run_migration\(path: String\) -> i32/u);
  assert.match(text, /acme_db::connect\(path\.clone\(\)\)\.await/u);
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

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("r5-async-provider-lib", result.artifacts);
});
