import { Worker } from "node:worker_threads";
import { createCommandCleanupOwner, retainCommandCleanup } from "./bounded-command-cleanup.js";
import {
  commandCleanup, commandLaunch, commandMemory,
  commandOutcome, commandPhase, commandState, nativeCommandErrorBytes,
  nativeCommandStartupMilliseconds, nativeCommandWatchdogGraceMilliseconds,
  notifyCommandChange, remainingCommandMilliseconds,
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
 * A late PID handoff retains one caller cleanup listener for at most 5 seconds
 * after return, subject to caller event-loop scheduling. Death before recoverable
 * PID publication cannot establish cleanup; bounded return is not containment.
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
  const cleanup = createCommandCleanupOwner(state, () => worker.postMessage("cleanup"));
  const retireWorker = retainCommandCleanup(worker, state, cleanup);
  const stopWorker = (): string => {
    const preventedSpawn = Atomics.compareExchange(state, commandState.launch,
      commandLaunch.initial, commandLaunch.prevented) === commandLaunch.initial;
    cleanup.reconcile(true);
    const spawning = Atomics.load(state, commandState.launch) === commandLaunch.admitted && cleanup.processId() === undefined;
    retireWorker();
    const cleanupFailure = cleanup.failure();
    return `${preventedSpawn ? " Worker startup did not complete." : ""}${
      spawning ? " Process cleanup handoff could not be confirmed." : ""}${
      cleanupFailure === undefined ? "" : ` ${cleanupFailure}`}`;
  };
  while (true) {
    const sequence = Atomics.load(state, commandState.sequence);
    cleanup.reconcile();
    if (Atomics.load(state, commandState.outcome) !== commandOutcome.pending) break;
    const waitingForStartup = Atomics.load(state, commandState.launch) === commandLaunch.initial;
    const waitDeadline = waitingForStartup && startupDeadline < watchdogDeadline ? startupDeadline : watchdogDeadline;
    const remaining = remainingCommandMilliseconds(waitDeadline);
    if (remaining <= 0) break;
    Atomics.wait(state, commandState.sequence, sequence, remaining);
  }
  if (Atomics.compareExchange(state, commandState.outcome, commandOutcome.pending,
    commandOutcome.cancelled) === commandOutcome.pending) {
    Atomics.notify(state, commandState.outcome);
    notifyCommandChange(state);
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
  const launch = Atomics.load(state, commandState.launch);
  const cleanupStatus = Atomics.load(state, commandState.cleanup);
  if ((outcome !== commandOutcome.success && outcome !== commandOutcome.failure) ||
      Atomics.load(state, commandState.phase) !== commandPhase.finished ||
      (launch !== commandLaunch.absent && launch !== commandLaunch.published) ||
      processId < 0 || (processId === 0) !== (launch === commandLaunch.absent) ||
      (processId > 0 && (!cleanup.attempted() || cleanup.processId() !== processId ||
        (cleanupStatus !== commandCleanup.complete && cleanupStatus !== commandCleanup.failed))) ||
      (outcome === commandOutcome.success && (processId === 0 || cleanupStatus !== commandCleanup.complete || cleanup.failure() !== undefined))) {
    const message = memory.error.toString("utf8", 0, errorBytes);
    throw new Error(`Native Rust command returned an incomplete result: ${message}.${stopWorker()}`);
  }
  retireWorker();
  if (outcome !== commandOutcome.success) {
    const diagnostics = memory.stderr.toString("utf8", 0, stderrBytes);
    const message = memory.error.toString("utf8", 0, errorBytes);
    const cleanupFailure = cleanup.failure();
    throw new Error(`Native Rust source service failed: ${diagnostics}${diagnostics.length > 0 ? "\n" : ""}${message}${
      cleanupFailure === undefined ? "" : `; ${cleanupFailure}`}`);
  }
  return memory.stdout.toString("utf8", 0, stdoutBytes).trim();
}
