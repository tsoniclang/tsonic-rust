import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";
import {
  commandState, nativeCommandErrorBytes,
} from "../../../../dist/providers/native/protocol/bounded-command-state.js";

export const root = createTestWorkspace("rust-native-command-bounds");
export const protocolRoot = new URL("../../../../dist/providers/native/protocol/", import.meta.url);
export const posix = { skip: process.platform === "win32" };

function sourceFile(source) {
  const path = join(root, `${randomUUID()}.mjs`);
  writeFileSync(path, source);
  return path;
}

export function command(source, options = {}) {
  return {
    executable: process.execPath, arguments: [sourceFile(source)], directory: root,
    environment: process.env, timeoutMilliseconds: 3_000, maximumDiagnosticBytes: 16 * 1024,
    ...options,
  };
}

export function run(source, options = {}) {
  return runRustNativeCommand(command(source, options));
}

export function sharedInput(maximumDiagnosticBytes = 16) {
  return {
    command: command("", { maximumDiagnosticBytes }), deadlineNanoseconds: process.hrtime.bigint() + 1_000_000_000n,
    state: new SharedArrayBuffer(commandState.length * Int32Array.BYTES_PER_ELEMENT),
    stdout: new SharedArrayBuffer(maximumDiagnosticBytes), stderr: new SharedArrayBuffer(maximumDiagnosticBytes),
    error: new SharedArrayBuffer(nativeCommandErrorBytes),
  };
}

export async function fixtureRunner(setup, replacement = false) {
  const directory = join(root, randomUUID());
  mkdirSync(directory);
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const file of ["bounded-command.js", "bounded-command-state.js"]) {
    copyFileSync(new URL(file, protocolRoot), join(directory, file));
  }
  copyFileSync(new URL("bounded-command-worker.js", protocolRoot), join(directory, "implementation.js"));
  writeFileSync(join(directory, "bounded-command-worker.js"), replacement ? setup : `${setup}\nawait import("./implementation.js");`);
  return (await import(pathToFileURL(join(directory, "bounded-command.js")).href)).runRustNativeCommand;
}

export function isolated(source, workerData = {}) {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { workerData, execArgv: [] });
  const result = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { void worker.terminate(); reject(new Error("Isolated control exceeded its deadline.")); }, 20_000);
    worker.once("message", message => { clearTimeout(deadline); resolve(message); });
    worker.once("error", error => { clearTimeout(deadline); reject(error); });
    worker.once("exit", code => { clearTimeout(deadline); reject(new Error(`Isolated control exited without a result (${code}).`)); });
  });
  return { worker, result };
}

export function processRunning(identity) {
  try { process.kill(identity, 0); }
  catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  if (process.platform === "linux") {
    try {
      const fields = readFileSync(`/proc/${identity}/stat`, "utf8");
      return !["Z", "X"].includes(fields.slice(fields.lastIndexOf(")") + 2, fields.lastIndexOf(")") + 3));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

export function expectDead(identities) {
  const deadline = Date.now() + 5_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (identities.some(processRunning) && Date.now() < deadline) Atomics.wait(pause, 0, 0, 10);
  for (const identity of identities) assert.equal(processRunning(identity), false, `native child ${identity} remains active`);
}

export function cleanRecordedProcesses(path) {
  if (!existsSync(path)) return;
  for (const identity of JSON.parse(readFileSync(path, "utf8"))) {
    if (!processRunning(identity)) continue;
    try { process.kill(identity, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}

export function descendantSource(path, {
  detached = false, stdio = "inherit", grandchild = false, action = "setInterval(() => {}, 1000);",
} = {}) {
  const descendant = grandchild ? `
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["--input-type=module", "-e", "process.send('ready'); setInterval(() => {}, 1000);"], {
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
child.once("message", () => { process.send([child.pid]); child.disconnect(); });
setInterval(() => {}, 1000);` : "process.send([]); setInterval(() => {}, 1000);";
  return `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const descendant = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(descendant)}], {
  detached: ${detached}, stdio: ["ignore", ${JSON.stringify(stdio)}, ${JSON.stringify(stdio)}, "ipc"],
});
descendant.once("message", descendants => {
  writeFileSync(${JSON.stringify(path)}, JSON.stringify([process.pid, descendant.pid, ...descendants]));
  descendant.disconnect();
  descendant.unref();
  ${action}
});`;
}
