import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import {
  commandCleanup, commandErrorMessage, commandLaunch, commandOutcome, commandState,
  nativeCommandCleanupMilliseconds, notifyCommandChange,
} from "./bounded-command-state.js";

export interface CommandCleanupOwner {
  observe(processId: number): void;
  reconcile(force?: boolean): void;
  failure(): string | undefined;
  processId(): number | undefined;
  attempted(): boolean;
}

export function createCommandCleanupOwner(state: Int32Array, acknowledge: () => void): CommandCleanupOwner {
  let identity: number | undefined;
  let attempted = false;
  let failure: string | undefined;
  const observe = (processId: number): void => {
    if (processId === 0) return;
    if (!Number.isSafeInteger(processId) || processId <= 0 || processId > 0x7fffffff ||
        (identity !== undefined && identity !== processId)) {
      failure ??= "Invalid or conflicting native Rust process identity.";
      return;
    }
    identity = processId;
  };
  return {
    observe,
    failure: () => failure,
    processId: () => identity,
    attempted: () => attempted,
    reconcile(force = false): void {
      observe(Atomics.load(state, commandState.processId));
      if (attempted || identity === undefined || (!force &&
          Atomics.load(state, commandState.cleanup) !== commandCleanup.requested)) return;
      attempted = true;
      try {
        terminateProcessTree(identity);
        Atomics.store(state, commandState.cleanup, commandCleanup.complete);
      } catch (error) {
        failure ??= `Native Rust process-tree cleanup failed: ${commandErrorMessage(error)}`;
        try { process.kill(identity, "SIGKILL"); }
        catch (rootError) {
          if (!isMissingProcess(rootError)) failure += `; root cleanup failed: ${commandErrorMessage(rootError)}`;
        }
        Atomics.store(state, commandState.cleanup, commandCleanup.failed);
      }
      notifyCommandChange(state);
      acknowledge();
    },
  };
}

export function retainCommandCleanup(worker: Worker, state: Int32Array, cleanup: CommandCleanupOwner): () => void {
  let retirement: NodeJS.Timeout | undefined;
  let exited = false;
  const cancel = (): void => {
    Atomics.compareExchange(state, commandState.outcome, commandOutcome.pending, commandOutcome.cancelled);
    notifyCommandChange(state);
  };
  worker.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null || !("kind" in message) || message.kind !== "pid" ||
        !("processId" in message) || typeof message.processId !== "number") {
      cancel();
      cleanup.reconcile(true);
      return;
    }
    cleanup.observe(message.processId);
    if (cleanup.failure() !== undefined) cancel();
    if (Atomics.load(state, commandState.outcome) !== commandOutcome.pending) {
      cleanup.reconcile(true);
      void worker.terminate();
    }
  });
  worker.once("error", () => { cancel(); cleanup.reconcile(true); });
  worker.once("exit", () => {
    exited = true;
    clearTimeout(retirement);
    cancel();
    cleanup.reconcile(true);
  });
  return (): void => {
    if (exited) return;
    const launch = Atomics.load(state, commandState.launch);
    if (launch !== commandLaunch.admitted || cleanup.processId() !== undefined) {
      void worker.terminate();
      return;
    }
    if (retirement === undefined) {
      retirement = setTimeout(() => {
        cleanup.reconcile(true);
        void worker.terminate();
      }, nativeCommandCleanupMilliseconds);
      retirement.unref();
    }
  };
}

function terminateProcessTree(processId: number): void {
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
  try { process.kill(-processId, "SIGKILL"); }
  catch (error) { if (!isMissingProcess(error)) throw error; }
}

function processExists(processId: number): boolean {
  try { process.kill(processId, 0); return true; }
  catch (error) { if (isMissingProcess(error)) return false; throw error; }
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}
