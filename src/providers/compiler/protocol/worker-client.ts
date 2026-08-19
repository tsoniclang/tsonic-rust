import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type {
  RustCompilerDependency,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerStandardLibrarySnapshot,
} from "../model/model.js";
import { rustCompilerProviderProtocolVersion } from "../model/model.js";
import type {
  RustCompilerWorkerRequest,
  RustCompilerWorkerResponse,
} from "./protocol.js";

const startupTimeoutMilliseconds = 30_000;
const requestTimeoutMilliseconds = 600_000;
const pollMilliseconds = 20;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const sessions = new Map<string, RustCompilerWorkerSession>();

interface RustCompilerWorkerSession {
  readonly child: ChildProcess;
  readonly processId: number;
  readonly root: string;
  readonly requestsDirectory: string;
  readonly responsesDirectory: string;
}

export interface RustCompilerWorkerClient {
  snapshot(manifestPath: string): RustCompilerProjectSnapshot;
  standardSnapshot(): RustCompilerStandardLibrarySnapshot;
  module(options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
    readonly modulePath: readonly string[];
    readonly requestedExports?: readonly string[];
  }): RustCompilerModuleModel;
}

export function createRustCompilerWorkerClient(root = defaultWorkerRoot()): RustCompilerWorkerClient {
  const session = getWorkerSession(resolve(root));
  return Object.freeze({
    snapshot(manifestPath: string): RustCompilerProjectSnapshot {
      const response = request(session, {
        protocolVersion: rustCompilerProviderProtocolVersion,
        id: requestId(),
        kind: "snapshot",
        manifestPath,
      });
      if (response.kind !== "snapshot") {
        throw responseError(response);
      }
      return response.snapshot;
    },
    standardSnapshot(): RustCompilerStandardLibrarySnapshot {
      const response = request(session, {
        protocolVersion: rustCompilerProviderProtocolVersion,
        id: requestId(),
        kind: "standard-snapshot",
      });
      if (response.kind !== "snapshot") {
        throw responseError(response);
      }
      if (response.snapshot.kind !== "standard-library") {
        throw new Error("Rust compiler-provider worker returned a non-standard snapshot for the standard library.");
      }
      return response.snapshot;
    },
    module(options: {
      readonly snapshot: RustCompilerProjectSnapshot;
      readonly dependency: RustCompilerDependency;
      readonly modulePath: readonly string[];
      readonly requestedExports?: readonly string[];
    }): RustCompilerModuleModel {
      const targetDirectory = join(session.root, "cargo", options.snapshot.digest, options.dependency.sourceDigest);
      const response = request(session, {
        protocolVersion: rustCompilerProviderProtocolVersion,
        id: requestId(),
        kind: "module",
        snapshot: options.snapshot,
        dependency: options.dependency,
        modulePath: options.modulePath,
        ...(options.requestedExports === undefined ? {} : { requestedExports: options.requestedExports }),
        targetDirectory,
      });
      if (response.kind !== "module") {
        throw responseError(response);
      }
      return response.module;
    },
  });
}

function getWorkerSession(root: string): RustCompilerWorkerSession {
  const existing = sessions.get(root);
  if (existing !== undefined && isProcessAlive(existing.processId)) {
    return existing;
  }
  const sessionRoot = join(root, "worker", `${process.pid}-${randomUUID()}`);
  const requestsDirectory = join(sessionRoot, "requests");
  const responsesDirectory = join(sessionRoot, "responses");
  const readyFile = join(sessionRoot, "ready.json");
  mkdirSync(requestsDirectory, { recursive: true });
  mkdirSync(responsesDirectory, { recursive: true });
  const workerEntry = fileURLToPath(new URL("./worker-entry.js", import.meta.url));
  const child = spawn(process.execPath, [
    workerEntry,
    "--requests-dir",
    requestsDirectory,
    "--responses-dir",
    responsesDirectory,
    "--ready-file",
    readyFile,
    "--owner-pid",
    String(process.pid),
  ], {
    detached: true,
    env: {
      ...process.env,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, "--max-old-space-size=1024"),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new Error("Rust compiler-provider worker process did not start.");
  }
  child.unref();
  if (!waitForFile(readyFile, startupTimeoutMilliseconds, child.pid)) {
    child.kill("SIGKILL");
    throw new Error("Rust compiler-provider worker did not become ready.");
  }
  const session = Object.freeze({
    child,
    processId: child.pid,
    root,
    requestsDirectory,
    responsesDirectory,
  });
  sessions.set(root, session);
  return session;
}

function request(
  session: RustCompilerWorkerSession,
  value: RustCompilerWorkerRequest,
): RustCompilerWorkerResponse {
  const requestPath = join(session.requestsDirectory, `${value.id}.json`);
  const temporaryPath = `${requestPath}.${randomUUID()}.tmp`;
  const responsePath = join(session.responsesDirectory, `${value.id}.json`);
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, requestPath);
  if (!waitForFile(responsePath, requestTimeoutMilliseconds, session.processId)) {
    terminateSession(session);
    throw new Error(`Rust compiler-provider worker did not produce response '${value.id}'.`);
  }
  let responseText: string;
  try {
    responseText = readFileSync(responsePath, "utf8");
  } finally {
    unlinkSync(responsePath);
  }
  const parsed = JSON.parse(responseText) as unknown;
  if (!isWorkerResponse(parsed) || parsed.id !== value.id) {
    throw new Error(`Rust compiler-provider worker emitted an invalid response for '${value.id}'.`);
  }
  return parsed;
}

function terminateSession(session: RustCompilerWorkerSession): void {
  sessions.delete(session.root);
  if (isProcessAlive(session.processId)) {
    session.child.kill("SIGKILL");
  }
}

function isWorkerResponse(value: unknown): value is RustCompilerWorkerResponse {
  return isRecord(value) && value.protocolVersion === rustCompilerProviderProtocolVersion &&
    typeof value.id === "string" &&
    (value.kind === "snapshot" || value.kind === "module" || value.kind === "error");
}

function responseError(response: RustCompilerWorkerResponse): Error {
  return response.kind === "error"
    ? new Error(`${response.code}: ${response.message}${response.details.length === 0 ? "" : ` (${response.details.join("; ")})`}`)
    : new Error(`Rust compiler-provider worker returned '${response.kind}' for the wrong request kind.`);
}

function waitForFile(path: string, timeoutMilliseconds: number, processId: number): boolean {
  const deadline = performance.now() + timeoutMilliseconds;
  while (performance.now() <= deadline) {
    if (existsSync(path)) {
      return true;
    }
    if (!isProcessAlive(processId)) {
      return false;
    }
    Atomics.wait(sleepBuffer, 0, 0, pollMilliseconds);
  }
  return existsSync(path);
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultWorkerRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../.temp/rust-compiler-provider");
}

function requestId(): string {
  return `${process.pid}-${Date.now()}-${randomUUID()}`;
}

function appendNodeOption(current: string | undefined, option: string): string {
  return current === undefined || current.length === 0 ? option : `${current} ${option}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
