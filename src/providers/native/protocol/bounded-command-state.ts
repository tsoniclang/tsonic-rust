import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { RustNativeCommand } from "./bounded-command.js";

export const nativeCommandStartupMilliseconds = 5_000;
export const nativeCommandCleanupMilliseconds = 5_000;
export const nativeCommandWatchdogGraceMilliseconds = 6_000;
export const nativeCommandErrorBytes = 4_096;

export const commandState = Object.freeze({
  outcome: 0, phase: 1, processId: 2, cleanup: 3,
  stdoutBytes: 4, stderrBytes: 5, errorBytes: 6, length: 7,
});
export const commandOutcome = Object.freeze({ pending: 0, success: 1, failure: 2, cancelled: 3 });
export const commandPhase = Object.freeze({ initial: 0, spawning: 1, watching: 2, finished: 3 });
export const commandCleanup = Object.freeze({ pending: 0, claimed: 1, complete: 2, failed: 3 });

export interface CommandWorkerInput {
  readonly command: RustNativeCommand;
  readonly deadlineNanoseconds: bigint;
  readonly state: SharedArrayBuffer;
  readonly stdout: SharedArrayBuffer;
  readonly stderr: SharedArrayBuffer;
  readonly error: SharedArrayBuffer;
}

export interface CommandMemory {
  readonly state: Int32Array;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly error: Buffer;
}

export function commandMemory(input: CommandWorkerInput): CommandMemory {
  return {
    state: new Int32Array(input.state),
    stdout: Buffer.from(input.stdout),
    stderr: Buffer.from(input.stderr),
    error: Buffer.from(input.error),
  };
}

export function remainingCommandMilliseconds(deadlineNanoseconds: bigint): number {
  return Number(deadlineNanoseconds - process.hrtime.bigint()) / 1_000_000;
}

export function commandErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, nativeCommandErrorBytes);
}

export function publishCommandResult(memory: CommandMemory, success: boolean, message: string): void {
  const { state } = memory;
  if (Atomics.load(state, commandState.outcome) !== commandOutcome.pending) return;
  const length = memory.error.write(message, "utf8");
  Atomics.store(state, commandState.errorBytes, length);
  Atomics.compareExchange(state, commandState.outcome, commandOutcome.pending,
    success ? commandOutcome.success : commandOutcome.failure);
  Atomics.notify(state, commandState.outcome);
}

export function cleanupCommandProcess(memory: CommandMemory): string | undefined {
  const { state } = memory;
  const processId = Atomics.load(state, commandState.processId);
  if (processId < 0) return "Invalid native Rust process identity.";
  if (processId === 0 || Atomics.compareExchange(state, commandState.cleanup,
    commandCleanup.pending, commandCleanup.claimed) !== commandCleanup.pending) return undefined;
  try {
    terminateProcessTree(processId);
    Atomics.store(state, commandState.cleanup, commandCleanup.complete);
    return undefined;
  } catch (error) {
    let message = `Native Rust process-tree cleanup failed: ${commandErrorMessage(error)}`;
    try {
      process.kill(processId, "SIGKILL");
    } catch (rootError) {
      if (!isMissingProcess(rootError)) message += `; root cleanup failed: ${commandErrorMessage(rootError)}`;
    }
    Atomics.store(state, commandState.cleanup, commandCleanup.failed);
    return message;
  }
}

function terminateProcessTree(processId: number): void {
  if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("Invalid native Rust process identity.");
  if (process.platform === "win32") {
    const systemRoot = Object.entries(process.env).find(([key]) => key.toLowerCase() === "systemroot")?.[1];
    if (systemRoot === undefined) throw new Error("Windows process-tree cleanup requires SystemRoot.");
    const result = spawnSync(join(systemRoot, "System32", "taskkill.exe"), ["/pid", String(processId), "/T", "/F"], {
      timeout: nativeCommandCleanupMilliseconds, killSignal: "SIGKILL", stdio: "ignore", windowsHide: true,
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0 && processExists(processId)) {
      throw new Error(`taskkill failed (exit ${result.status ?? result.signal ?? "unknown"}).`);
    }
    return;
  }
  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    throw error;
  }
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}
