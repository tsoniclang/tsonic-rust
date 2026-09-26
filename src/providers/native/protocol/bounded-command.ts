import { Worker } from "node:worker_threads";
import {
  cleanupCommandProcess, commandCleanup, commandErrorMessage, commandMemory,
  commandOutcome, commandPhase, commandState, nativeCommandErrorBytes,
  nativeCommandStartupMilliseconds, nativeCommandWatchdogGraceMilliseconds,
  publishCommandResult, remainingCommandMilliseconds,
} from "./bounded-command-state.js";
import type { CommandWorkerInput } from "./bounded-command-state.js";

export interface RustNativeCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMilliseconds: number;
  readonly maximumDiagnosticBytes: number;
}

/**
 * Bounds startup, execution and pipe drainage by one monotonic deadline and a
 * combined stdout/stderr byte limit. Cleanup/watchdog handling has an additional
 * 6-second watchdog grace plus at most 5 seconds for caller-side taskkill;
 * worker startup is independently capped at 5 seconds. OS scheduling and
 * uninterruptible kernel calls are not hard real-time guarantees. Shared stream
 * storage reserves twice the byte limit.
 * POSIX cleanup signals the isolated process group, including members surviving
 * its leader. Windows taskkill targets the tree it can still discover by root PID.
 * Neither contains escaped groups/sessions, discovers every Windows orphan, reaps
 * nonchildren, limits native memory, or prevents filesystem writes. Failed queries
 * throw and must not publish evidence, even if the command wrote a response file.
 */
export function runRustNativeCommand(command: RustNativeCommand): string {
  if (!Number.isSafeInteger(command.maximumDiagnosticBytes) || command.maximumDiagnosticBytes <= 0 ||
      command.maximumDiagnosticBytes > 64 * 1024 * 1024 || !Number.isSafeInteger(command.timeoutMilliseconds) ||
      command.timeoutMilliseconds <= 0 || command.timeoutMilliseconds > 3_600_000) {
    throw new Error("Native Rust command requires finite positive deadline and diagnostic limits.");
  }
  const start = process.hrtime.bigint();
  const deadlineNanoseconds = start + BigInt(command.timeoutMilliseconds) * 1_000_000n;
  const startupDeadline = start + BigInt(nativeCommandStartupMilliseconds) * 1_000_000n;
  const watchdogDeadline = deadlineNanoseconds + BigInt(nativeCommandWatchdogGraceMilliseconds) * 1_000_000n;
  const input: CommandWorkerInput = {
    command, deadlineNanoseconds,
    state: new SharedArrayBuffer(commandState.length * Int32Array.BYTES_PER_ELEMENT),
    stdout: new SharedArrayBuffer(command.maximumDiagnosticBytes),
    stderr: new SharedArrayBuffer(command.maximumDiagnosticBytes),
    error: new SharedArrayBuffer(nativeCommandErrorBytes),
  };
  const memory = commandMemory(input);
  const { state } = memory;
  const worker = new Worker(new URL("./bounded-command-worker.js", import.meta.url), {
    workerData: input, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  worker.unref();
  const handleWorkerError = (error: unknown): void => {
    const cleanupError = cleanupCommandProcess(memory, "caller");
    publishCommandResult(memory, false, `Native Rust command worker failed: ${commandErrorMessage(error)}${
      cleanupError === undefined ? "" : `; ${cleanupError}`}`);
  };
  worker.once("error", handleWorkerError);
  const retireWorker = (): void => {
    worker.off("error", handleWorkerError);
    worker.once("error", ignoreRetiredWorkerError);
  };
  const stopWorker = (): string => {
    const preventedSpawn = Atomics.compareExchange(state, commandState.phase,
      commandPhase.initial, commandPhase.finished) === commandPhase.initial;
    const spawning = Atomics.load(state, commandState.phase) === commandPhase.spawning;
    const cleanupError = cleanupCommandProcess(memory, "caller");
    const cleanupStatus = Atomics.load(state, commandState.cleanup);
    const cleaning = cleanupStatus === commandCleanup.claimed || cleanupStatus === commandCleanup.reclaimed;
    const cleanupFailure = cleanupError ?? (cleanupStatus === commandCleanup.failed ? "Process-tree cleanup failed." : undefined);
    if (preventedSpawn || (!spawning && !cleaning)) {
      retireWorker();
      void worker.terminate();
    }
    return `${preventedSpawn ? " Worker startup did not complete." : ""}${
      spawning || cleaning ? " Process cleanup handoff could not be confirmed." : ""}${
      cleanupFailure === undefined ? "" : ` ${cleanupFailure}`}`;
  };
  while (Atomics.load(state, commandState.outcome) === commandOutcome.pending) {
    const waitingForStartup = Atomics.load(state, commandState.phase) === commandPhase.initial;
    const waitDeadline = waitingForStartup && startupDeadline < watchdogDeadline ? startupDeadline : watchdogDeadline;
    const remaining = remainingCommandMilliseconds(waitDeadline);
    if (remaining <= 0) break;
    Atomics.wait(state, commandState.outcome, commandOutcome.pending, remaining);
  }
  if (Atomics.compareExchange(state, commandState.outcome, commandOutcome.pending,
    commandOutcome.cancelled) === commandOutcome.pending) {
    Atomics.notify(state, commandState.outcome);
    throw new Error(`Native Rust command watchdog did not complete.${stopWorker()}`);
  }
  const stdoutBytes = Atomics.load(state, commandState.stdoutBytes);
  const stderrBytes = Atomics.load(state, commandState.stderrBytes);
  const errorBytes = Atomics.load(state, commandState.errorBytes);
  if (stdoutBytes < 0 || stderrBytes < 0 || stdoutBytes + stderrBytes > command.maximumDiagnosticBytes ||
      errorBytes < 0 || errorBytes > memory.error.length) {
    throw new Error(`Native Rust command returned invalid diagnostic lengths.${stopWorker()}`);
  }
  const outcome = Atomics.load(state, commandState.outcome);
  const processId = Atomics.load(state, commandState.processId);
  const cleanupStatus = Atomics.load(state, commandState.cleanup);
  if ((outcome !== commandOutcome.success && outcome !== commandOutcome.failure) ||
      Atomics.load(state, commandState.phase) !== commandPhase.finished ||
      processId < 0 ||
      (processId > 0 && cleanupStatus !== commandCleanup.complete && cleanupStatus !== commandCleanup.failed) ||
      (outcome === commandOutcome.success && (processId === 0 || cleanupStatus !== commandCleanup.complete))) {
    throw new Error(`Native Rust command returned an incomplete result.${stopWorker()}`);
  }
  retireWorker();
  if (outcome !== commandOutcome.success) {
    const diagnostics = memory.stderr.toString("utf8", 0, stderrBytes);
    const message = memory.error.toString("utf8", 0, errorBytes);
    throw new Error(`Native Rust source service failed: ${diagnostics}${diagnostics.length > 0 ? "\n" : ""}${message}`);
  }
  return memory.stdout.toString("utf8", 0, stdoutBytes).trim();
}

function ignoreRetiredWorkerError(): void {}
