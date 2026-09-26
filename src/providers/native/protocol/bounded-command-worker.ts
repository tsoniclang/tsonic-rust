import { spawn } from "node:child_process";
import { workerData } from "node:worker_threads";
import type { RustNativeCommand } from "./bounded-command.js";
import { terminateRustNativeProcessTree } from "./bounded-command.js";

interface CommandWorkerInput {
  readonly command: RustNativeCommand;
  readonly state: SharedArrayBuffer;
  readonly output: SharedArrayBuffer;
}

const { command, state: stateBuffer, output: outputBuffer } = workerData as CommandWorkerInput;
const state = new Int32Array(stateBuffer);
const output = new Uint8Array(outputBuffer);
let finished = false;
let failure: string | undefined;
let bytes = 0;
const stdout: Buffer[] = [];
const stderr: Buffer[] = [];

function finish(success: boolean, message: string | Buffer): void {
  if (finished) return;
  finished = true;
  const encoded = typeof message === "string" ? Buffer.from(message, "utf8") : message;
  const length = Math.min(encoded.length, output.length);
  output.set(encoded.subarray(0, length));
  Atomics.store(state, 2, length);
  Atomics.store(state, 0, success ? 1 : 2);
  Atomics.notify(state, 0);
}

const child = spawn(command.executable, command.arguments, {
  cwd: command.directory,
  env: command.environment,
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
if (child.pid !== undefined) Atomics.store(state, 1, child.pid);

function reject(message: string): void {
  if (failure !== undefined || finished) return;
  failure = message;
  if (child.pid !== undefined) {
    try { terminateRustNativeProcessTree(child.pid); }
    catch (error) { finish(false, `${message}; ${error instanceof Error ? error.message : String(error)}`); }
  }
}

const deadline = setTimeout(() => reject("Native Rust command exceeded its deadline."), command.timeoutMilliseconds);

function receive(chunks: Buffer[], chunk: Buffer): void {
  if (failure !== undefined || finished) return;
  bytes += chunk.length;
  if (bytes > command.maximumDiagnosticBytes) reject("Native Rust command exceeded its diagnostic byte limit.");
  else chunks.push(chunk);
}

child.stdout.on("data", (chunk: Buffer) => receive(stdout, chunk));
child.stderr.on("data", (chunk: Buffer) => receive(stderr, chunk));
child.on("error", error => {
  clearTimeout(deadline);
  finish(false, error.message);
});
child.on("close", (code, signal) => {
  clearTimeout(deadline);
  if (child.pid !== undefined && process.platform !== "win32") {
    try { terminateRustNativeProcessTree(child.pid); }
    catch (error) { failure = `Native Rust descendants were not terminated: ${error instanceof Error ? error.message : String(error)}`; }
  }
  if (failure !== undefined) finish(false, failure);
  else if (code === 0) finish(true, Buffer.concat(stdout));
  else finish(false, `${Buffer.concat(stderr).toString("utf8")}\nExit: ${code ?? signal ?? "unknown"}`);
});
