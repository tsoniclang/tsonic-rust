import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  commandCleanup, commandMemory, commandState, notifyCommandChange,
} from "../../../../dist/providers/native/protocol/bounded-command-state.js";
import {
  root, protocolRoot, command, sharedInput, fixtureRunner, isolated,
  processRunning, cleanRecordedProcesses,
} from "./bounded-command-fixtures.mjs";

for (const fault of ["exit", "stall"]) {
  test(`a PID queued after caller cancellation remains cleanable if its worker then ${fault}s`, async () => {
    const identitiesPath = join(root, `${randomUUID()}.json`);
    const releasePath = join(root, `${randomUUID()}.release`);
    const runner = await fixtureRunner(`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { commandState } from "./bounded-command-state.js";
const pause = new Int32Array(new SharedArrayBuffer(4));
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([child.pid]));
  while (!existsSync(${JSON.stringify(releasePath)})) Atomics.wait(pause, 0, 0, 10);
  return child;
};
const originalStore = Atomics.store;
Atomics.store = (array, index, value) => {
  if (array.buffer === workerData.state && index === commandState.processId) {
    ${fault === "exit" ? "process.exit(91);" : "Atomics.wait(pause, 0, 0);"}
  }
  return originalStore(array, index, value);
};
syncBuiltinESMExports();`);
    try {
      assert.throws(() => runner(command("setInterval(() => {}, 1000);", {
        timeoutMilliseconds: 500,
      })), /watchdog[\s\S]*cleanup handoff could not be confirmed/u);
      const identities = JSON.parse(readFileSync(identitiesPath, "utf8"));
      assert.equal(processRunning(identities[0]), true);
      writeFileSync(releasePath, "caller has returned");
      const deadline = Date.now() + 5_000;
      while (identities.some(processRunning) && Date.now() < deadline) await delay(10);
      for (const identity of identities) assert.equal(processRunning(identity), false);
    } finally {
      writeFileSync(releasePath, "release during cleanup");
      await delay(20);
      cleanRecordedProcesses(identitiesPath);
    }
  });
}

test("a cleanup request with no PID does not consume the sole future cleanup attempt", async () => {
  const control = isolated(`
import { parentPort, workerData } from "node:worker_threads";
import { createCommandCleanupOwner } from ${JSON.stringify(new URL("bounded-command-cleanup.js", protocolRoot).href)};
import { commandCleanup, commandMemory, commandState, requestCommandCleanup } from ${JSON.stringify(new URL("bounded-command-state.js", protocolRoot).href)};
Object.defineProperty(process, "platform", { value: "linux" });
const { state } = commandMemory(workerData);
const calls = [];
process.kill = (identity, signal) => { calls.push([identity, signal]); return true; };
let acknowledgements = 0;
const owner = createCommandCleanupOwner(state, () => { acknowledgements += 1; });
requestCommandCleanup(state);
owner.reconcile(true);
const early = { attempted: owner.attempted(), cleanup: Atomics.load(state, commandState.cleanup) };
owner.observe(12345);
owner.reconcile(true);
owner.observe(12345);
owner.reconcile(true);
parentPort.postMessage({ early, calls, acknowledgements, failure: owner.failure(), cleanup: Atomics.load(state, commandState.cleanup) });
`, sharedInput());
  const result = await control.result;
  assert.deepEqual(result.early, { attempted: false, cleanup: commandCleanup.requested });
  assert.deepEqual(result.calls, [[-12345, "SIGKILL"]]);
  assert.equal(result.acknowledgements, 1);
  assert.equal(result.failure, undefined);
  assert.equal(result.cleanup, commandCleanup.complete);
});

test("invalid or conflicting PID messages cannot select a second cleanup target", async () => {
  const control = isolated(`
import { parentPort, workerData } from "node:worker_threads";
import { createCommandCleanupOwner } from ${JSON.stringify(new URL("bounded-command-cleanup.js", protocolRoot).href)};
import { commandMemory } from ${JSON.stringify(new URL("bounded-command-state.js", protocolRoot).href)};
Object.defineProperty(process, "platform", { value: "linux" });
const calls = [];
process.kill = (identity, signal) => { calls.push([identity, signal]); return true; };
const invalid = [-1, 1.5, NaN, Infinity, 2147483648];
const failures = [];
for (const value of invalid) {
  const state = new Int32Array(workerData.state.slice(0));
  const owner = createCommandCleanupOwner(state, () => {});
  owner.observe(value);
  owner.reconcile(true);
  failures.push({ failure: owner.failure(), attempted: owner.attempted() });
}
const beforeValid = calls.length;
const { state } = commandMemory(workerData);
const owner = createCommandCleanupOwner(state, () => {});
owner.observe(12345);
owner.observe(54321);
owner.reconcile(true);
owner.observe(54321);
owner.reconcile(true);
parentPort.postMessage({ failures, beforeValid, calls, identity: owner.processId(), failure: owner.failure() });
`, sharedInput());
  const result = await control.result;
  assert.equal(result.failures.length, 5);
  for (const failure of result.failures) {
    assert.match(failure.failure, /Invalid or conflicting/u);
    assert.equal(failure.attempted, false);
  }
  assert.equal(result.beforeValid, 0);
  assert.equal(result.identity, 12345);
  assert.match(result.failure, /Invalid or conflicting/u);
  assert.deepEqual(result.calls, [[-12345, "SIGKILL"]]);
});

test("lifecycle notifications cannot be lost between observation and waiting", () => {
  const { state } = commandMemory(sharedInput());
  const before = Atomics.load(state, commandState.sequence);
  notifyCommandChange(state);
  assert.equal(Atomics.wait(state, commandState.sequence, before, 10_000), "not-equal");
});
