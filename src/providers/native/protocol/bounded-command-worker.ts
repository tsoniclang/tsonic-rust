import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { parentPort, workerData } from "node:worker_threads";
import {
  commandCleanup, commandErrorMessage, commandLaunch, commandMemory, commandOutcome,
  commandPhase, commandState, nativeCommandCleanupMilliseconds, nativeCommandErrorBytes,
  notifyCommandChange, publishCommandResult, remainingCommandMilliseconds, requestCommandCleanup,
} from "./bounded-command-state.js";
import type { CommandWorkerInput } from "./bounded-command-state.js";

const input = workerData as CommandWorkerInput;
const { command, deadlineNanoseconds } = input;
const memory = commandMemory(input);
const { state } = memory;
let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
let deadline: NodeJS.Timeout | undefined;
let cleanupDeadline: NodeJS.Timeout | undefined;
let finished = false;
let rejecting = false;
let exited = false;
let stdoutEnded = false;
let stderrEnded = false;
let failure: string | undefined;

function recordFailure(message: string): void {
  const boundedMessage = message.slice(0, nativeCommandErrorBytes / 4);
  failure = failure === undefined ? boundedMessage
    : `${failure}; ${boundedMessage}`.slice(0, nativeCommandErrorBytes);
}

function finish(): void {
  if (finished) return;
  if (failure === undefined && remainingCommandMilliseconds(deadlineNanoseconds) <= 0) {
    recordFailure("Native Rust command exceeded its deadline.");
  }
  finished = true;
  clearTimeout(deadline);
  clearTimeout(cleanupDeadline);
  child?.stdout.destroy();
  child?.stderr.destroy();
  child?.unref();
  parentPort?.close();
  Atomics.store(state, commandState.phase, commandPhase.finished);
  publishCommandResult(memory, failure === undefined, failure ?? "");
}

function reject(message: string): void {
  if (finished || rejecting) return;
  rejecting = true;
  recordFailure(message);
  clearTimeout(deadline);
  requestCommandCleanup(state);
  child?.stdout.destroy();
  child?.stderr.destroy();
  if (child?.pid === undefined) {
    finish();
  } else {
    cleanupDeadline = setTimeout(() => {
      recordFailure("Native Rust root process termination could not be confirmed.");
      finish();
    }, nativeCommandCleanupMilliseconds);
    maybeFinish();
  }
}

function maybeFinish(): void {
  if (finished) return;
  const cleanup = Atomics.load(state, commandState.cleanup);
  if (cleanup !== commandCleanup.complete && cleanup !== commandCleanup.failed) return;
  if (cleanup === commandCleanup.failed && failure === undefined) recordFailure("Native Rust process-tree cleanup failed.");
  if (exited && (rejecting || (stdoutEnded && stderrEnded))) finish();
}

function receive(stream: "stdout" | "stderr", chunk: Buffer): void {
  if (finished || rejecting) return;
  if (remainingCommandMilliseconds(deadlineNanoseconds) <= 0) {
    reject("Native Rust command exceeded its deadline.");
    return;
  }
  const total = Atomics.load(state, commandState.stdoutBytes) + Atomics.load(state, commandState.stderrBytes);
  if (chunk.length > command.maximumDiagnosticBytes - total) {
    reject("Native Rust command exceeded its diagnostic byte limit.");
    return;
  }
  const index = stream === "stdout" ? commandState.stdoutBytes : commandState.stderrBytes;
  const offset = Atomics.load(state, index);
  memory[stream].set(chunk, offset);
  Atomics.store(state, index, offset + chunk.length);
}

process.on("uncaughtException", error => reject(`Native Rust command worker failed: ${commandErrorMessage(error)}`));
process.on("unhandledRejection", error => reject(`Native Rust command worker failed: ${commandErrorMessage(error)}`));
parentPort?.on("message", () => maybeFinish());
process.on("exit", code => {
  if (finished) return;
  recordFailure(`Native Rust command worker exited before completion (exit ${code}).`);
  requestCommandCleanup(state);
  finish();
});

try {
  if (Atomics.compareExchange(state, commandState.launch, commandLaunch.initial,
    commandLaunch.admitted) === commandLaunch.initial) {
    Atomics.store(state, commandState.phase, commandPhase.spawning);
    notifyCommandChange(state);
    if (Atomics.load(state, commandState.outcome) !== commandOutcome.pending ||
        remainingCommandMilliseconds(deadlineNanoseconds) <= 0) {
      Atomics.store(state, commandState.launch, commandLaunch.absent);
      reject("Native Rust command exceeded its deadline before invocation.");
    } else {
      child = spawn(command.executable, command.arguments, {
        cwd: command.directory, env: command.environment,
        detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      if (child.pid !== undefined) {
        parentPort?.postMessage({ kind: "pid", processId: child.pid });
        Atomics.store(state, commandState.processId, child.pid);
      }
      Atomics.store(state, commandState.launch, child.pid === undefined ? commandLaunch.absent : commandLaunch.published);
      Atomics.store(state, commandState.phase, commandPhase.watching);
      notifyCommandChange(state);
      child.stdout.on("data", (chunk: Buffer) => receive("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => receive("stderr", chunk));
      child.stdout.on("error", error => reject(`Native Rust stdout failed: ${commandErrorMessage(error)}`));
      child.stderr.on("error", error => reject(`Native Rust stderr failed: ${commandErrorMessage(error)}`));
      child.stdout.on("end", () => { stdoutEnded = true; maybeFinish(); });
      child.stderr.on("end", () => { stderrEnded = true; maybeFinish(); });
      child.stdout.on("close", () => {
        if (!stdoutEnded) reject("Native Rust stdout closed before EOF.");
      });
      child.stderr.on("close", () => {
        if (!stderrEnded) reject("Native Rust stderr closed before EOF.");
      });
      child.on("error", error => reject(`Native Rust command could not execute: ${commandErrorMessage(error)}`));
      child.on("exit", (code, signal) => {
        exited = true;
        if (!rejecting && code !== 0) recordFailure(`Exit: ${code ?? signal ?? "unknown"}`);
        requestCommandCleanup(state);
        maybeFinish();
      });
      if (Atomics.load(state, commandState.outcome) !== commandOutcome.pending ||
          remainingCommandMilliseconds(deadlineNanoseconds) <= 0) {
        reject("Native Rust command exceeded its deadline.");
      } else {
        deadline = setTimeout(() => reject("Native Rust command exceeded its deadline."),
          remainingCommandMilliseconds(deadlineNanoseconds));
      }
    }
  }
} catch (error) {
  reject(`Native Rust command worker failed: ${commandErrorMessage(error)}`);
}
