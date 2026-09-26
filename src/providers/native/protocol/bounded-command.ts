import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";

export interface RustNativeCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMilliseconds: number;
  readonly maximumDiagnosticBytes: number;
}

export function runRustNativeCommand(command: RustNativeCommand): string {
  if (!Number.isSafeInteger(command.maximumDiagnosticBytes) || command.maximumDiagnosticBytes <= 0 ||
      command.maximumDiagnosticBytes > 64 * 1024 * 1024 || !Number.isSafeInteger(command.timeoutMilliseconds) ||
      command.timeoutMilliseconds <= 0 || command.timeoutMilliseconds > 3_600_000) {
    throw new Error("Native Rust command requires finite positive deadline and diagnostic limits.");
  }
  const state = new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT));
  const output = new Uint8Array(new SharedArrayBuffer(command.maximumDiagnosticBytes));
  const worker = new Worker(new URL("./bounded-command-worker.js", import.meta.url), {
    workerData: { command, state: state.buffer, output: output.buffer },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  worker.on("error", () => {});
  const status = Atomics.wait(state, 0, 0, command.timeoutMilliseconds + 10_000);
  if (status === "timed-out") {
    const processId = Atomics.load(state, 1);
    if (processId > 0) terminateRustNativeProcessTree(processId);
    void worker.terminate();
    throw new Error("Native Rust command watchdog did not complete.");
  }
  void worker.terminate();
  const length = Atomics.load(state, 2);
  if (length < 0 || length > output.length) throw new Error("Native Rust command returned an invalid diagnostic length.");
  const message = Buffer.from(output.subarray(0, length)).toString("utf8");
  if (Atomics.load(state, 0) !== 1) {
    throw new Error(`Native Rust source service failed: ${message}`);
  }
  return message.trim();
}

export function terminateRustNativeProcessTree(processId: number): void {
  if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("Invalid native Rust process identity.");
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(processId), "/T", "/F"], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true,
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0 && processExists(processId)) {
      throw new Error(`Native Rust process-tree termination failed: ${result.stderr.trim()}`);
    }
    return;
  }
  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}
