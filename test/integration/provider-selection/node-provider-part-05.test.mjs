import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeMethods, nativeType,
  nativeBorrow, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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
