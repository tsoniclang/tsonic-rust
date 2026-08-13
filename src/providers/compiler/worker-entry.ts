import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createRustCompilerProjectSnapshot } from "./cargo-snapshot.js";
import { rustCompilerProviderProtocolVersion } from "./model.js";
import type {
  RustCompilerWorkerRequest,
  RustCompilerWorkerResponse,
} from "./protocol.js";
import { loadRustCompilerModule } from "./rustdoc.js";

const pollMilliseconds = 20;
const ownerPollMilliseconds = 1_000;

const options = readServerOptions(process.argv.slice(2));
mkdirSync(options.requestsDirectory, { recursive: true });
mkdirSync(options.responsesDirectory, { recursive: true });
writeJsonAtomically(options.readyFile, {
  protocolVersion: rustCompilerProviderProtocolVersion,
  processId: process.pid,
});

let processing = false;
const requestTimer = setInterval(() => {
  if (processing) {
    return;
  }
  processing = true;
  try {
    processPendingRequests();
  } finally {
    processing = false;
  }
}, pollMilliseconds);

const ownerTimer = setInterval(() => {
  if (!isProcessAlive(options.ownerProcessId)) {
    clearInterval(requestTimer);
    clearInterval(ownerTimer);
    process.exit(0);
  }
}, ownerPollMilliseconds);

function processPendingRequests(): void {
  const files = readdirSync(options.requestsDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort(compareText);
  for (const file of files) {
    const requestPath = join(options.requestsDirectory, file);
    let requestId = basename(file, ".json");
    let response: RustCompilerWorkerResponse;
    try {
      const request = parseRequest(readFileSync(requestPath, "utf8"));
      requestId = request.id;
      response = processRequest(request);
    } catch (error) {
      response = {
        protocolVersion: rustCompilerProviderProtocolVersion,
        id: requestId,
        kind: "error",
        code: "RUST_COMPILER_PROVIDER_WORKER_FAILED",
        message: error instanceof Error ? error.message : String(error),
        details: [],
      };
    }
    writeJsonAtomically(join(options.responsesDirectory, `${requestId}.json`), response);
    unlinkSync(requestPath);
  }
}

function processRequest(request: RustCompilerWorkerRequest): RustCompilerWorkerResponse {
  if (request.kind === "snapshot") {
    return {
      protocolVersion: rustCompilerProviderProtocolVersion,
      id: request.id,
      kind: "snapshot",
      snapshot: createRustCompilerProjectSnapshot(request.manifestPath),
    };
  }
  return {
    protocolVersion: rustCompilerProviderProtocolVersion,
    id: request.id,
    kind: "module",
    module: loadRustCompilerModule({
      snapshot: request.snapshot,
      dependency: request.dependency,
      modulePath: request.modulePath,
      ...(request.requestedExports === undefined ? {} : { requestedExports: request.requestedExports }),
      targetDirectory: request.targetDirectory,
    }),
  };
}

function parseRequest(text: string): RustCompilerWorkerRequest {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value) || value.protocolVersion !== rustCompilerProviderProtocolVersion ||
    typeof value.id !== "string" || value.id.length === 0 ||
    (value.kind !== "snapshot" && value.kind !== "module")) {
    throw new Error("Rust compiler-provider worker received an invalid request envelope.");
  }
  if (value.kind === "snapshot") {
    if (typeof value.manifestPath !== "string" || value.manifestPath.length === 0) {
      throw new Error("Rust compiler-provider snapshot request has no manifest path.");
    }
  } else if (!isRecord(value.snapshot) || !isRecord(value.dependency) ||
    !Array.isArray(value.modulePath) || typeof value.targetDirectory !== "string") {
    throw new Error("Rust compiler-provider module request has an invalid payload.");
  }
  return value as unknown as RustCompilerWorkerRequest;
}

function readServerOptions(args: readonly string[]): {
  readonly requestsDirectory: string;
  readonly responsesDirectory: string;
  readonly readyFile: string;
  readonly ownerProcessId: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error("Rust compiler-provider worker requires exact key/value server arguments.");
    }
    values.set(key, value);
  }
  const requestsDirectory = requireOption(values, "--requests-dir");
  const responsesDirectory = requireOption(values, "--responses-dir");
  const readyFile = requireOption(values, "--ready-file");
  const ownerProcessId = Number(requireOption(values, "--owner-pid"));
  if (!Number.isSafeInteger(ownerProcessId) || ownerProcessId <= 0) {
    throw new Error("Rust compiler-provider worker owner pid must be a positive integer.");
  }
  return { requestsDirectory, responsesDirectory, readyFile, ownerProcessId };
}

function requireOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Rust compiler-provider worker requires '${name}'.`);
  }
  return value;
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, path);
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
