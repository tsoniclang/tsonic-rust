import type { RustNativeCommand } from "./bounded-command.js";

export const nativeCommandStartupMilliseconds = 5_000;
export const nativeCommandCleanupMilliseconds = 5_000;
export const nativeCommandWatchdogGraceMilliseconds = 6_000;
export const nativeCommandErrorBytes = 4_096;

export const commandState = Object.freeze({
  outcome: 0, phase: 1, processId: 2, cleanup: 3,
  stdoutBytes: 4, stderrBytes: 5, errorBytes: 6, sequence: 7, launch: 8, length: 9,
});
export const commandOutcome = Object.freeze({ pending: 0, success: 1, failure: 2, cancelled: 3 });
export const commandPhase = Object.freeze({ initial: 0, spawning: 1, watching: 2, finished: 3 });
export const commandLaunch = Object.freeze({ initial: 0, admitted: 1, absent: 2, published: 3, prevented: 4 });
export const commandCleanup = Object.freeze({ pending: 0, requested: 1, complete: 2, failed: 3 });

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
  notifyCommandChange(state);
}

export function notifyCommandChange(state: Int32Array): void {
  Atomics.add(state, commandState.sequence, 1);
  Atomics.notify(state, commandState.sequence);
}

export function requestCommandCleanup(state: Int32Array): void {
  if (Atomics.compareExchange(state, commandState.cleanup, commandCleanup.pending,
    commandCleanup.requested) === commandCleanup.pending) notifyCommandChange(state);
}
