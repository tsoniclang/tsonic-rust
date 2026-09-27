import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";
import {
  commandCleanup, commandMemory, commandOutcome, commandPhase, commandState,
  nativeCommandCleanupMilliseconds, nativeCommandErrorBytes, publishCommandResult,
} from "../../../../dist/providers/native/protocol/bounded-command-state.js";
import {
  root, protocolRoot, posix, command, run, sharedInput, fixtureRunner, isolated,
  processRunning, expectDead, cleanRecordedProcesses, descendantSource,
} from "./bounded-command-fixtures.mjs";

test("the command boundary exports one synchronous runner and no superseded cleanup API", async () => {
  const surface = await import(new URL("bounded-command.js", protocolRoot).href);
  assert.deepEqual(Object.keys(surface), ["runRustNativeCommand"]);
});

test("native commands retain complete stdout, stderr failures and exact byte boundaries", () => {
  assert.equal(run('process.stdout.write("complete\\n");'), "complete");
  assert.equal(run('process.stderr.write("warning");'), "");
  assert.equal(run('process.stdout.write("x");', { maximumDiagnosticBytes: 1 }), "x");
  assert.equal(run('process.stdout.write("abcd"); process.stderr.write("efgh");', { maximumDiagnosticBytes: 8 }), "abcd");
  assert.throws(() => run('process.stderr.write("native rejection", () => process.exit(7));'), /native rejection[\s\S]*Exit: 7/u);
  assert.throws(() => run('process.stderr.write("x", () => process.exit(7));', { maximumDiagnosticBytes: 1 }), /x[\s\S]*Exit: 7/u);
  for (const stream of ["stdout", "stderr"]) {
    assert.throws(() => run(`process.${stream}.write("x".repeat(32_000));`), /diagnostic byte limit/u);
    assert.throws(() => run(`process.${stream}.write("xx");`, { maximumDiagnosticBytes: 1 }), /diagnostic byte limit/u);
  }
  assert.throws(() => run('process.stdout.write("abcd"); process.stderr.write("efghi");', { maximumDiagnosticBytes: 8 }), /diagnostic byte limit/u);
  assert.equal(run("", { maximumDiagnosticBytes: 64 * 1024 * 1024, timeoutMilliseconds: 3_600_000 }), "");
});

test("UTF-8 split across chunks is decoded once and budgets count bytes, not characters", () => {
  const text = "é😀";
  assert.equal(run(`
const bytes = Buffer.from(${JSON.stringify(text)});
for (const byte of bytes) await new Promise(resolve => process.stdout.write(Buffer.from([byte]), resolve));
`, { maximumDiagnosticBytes: 6 }), text);
  assert.throws(() => run(`process.stdout.write(${JSON.stringify(text)});`, { maximumDiagnosticBytes: 5 }), /diagnostic byte limit/u);
  assert.throws(() => run(`
for (const byte of Buffer.from(${JSON.stringify(text)})) {
  await new Promise(resolve => process.stderr.write(Buffer.from([byte]), resolve));
}
process.exitCode = 9;
`, { maximumDiagnosticBytes: 6 }), /é😀[\s\S]*Exit: 9/u);
  assert.equal(run('for (let index = 0; index < 4096; index += 1) process.stdout.write("x");', { maximumDiagnosticBytes: 4096 }), "x".repeat(4096));
});

test("invocation preserves arguments, environment and cwd without a shell", () => {
  const arguments_ = ["space separated", "$(echo must-not-run)", "semicolon;literal", "quote'\""];
  const input = command('process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), value: process.env.NATIVE_VALUE }));');
  assert.deepEqual(JSON.parse(runRustNativeCommand({ ...input, arguments: [...input.arguments, ...arguments_], environment: { ...process.env, NATIVE_VALUE: "chosen" } })), {
    args: arguments_, cwd: root, value: "chosen",
  });
});

test("invalid budgets reject before invocation, including wrong runtime types and upper bounds", () => {
  const marker = join(root, randomUUID());
  for (const [field, ceiling] of [["timeoutMilliseconds", 3_600_000], ["maximumDiagnosticBytes", 64 * 1024 * 1024]]) {
    for (const value of [0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, ceiling + 1, "1", null, undefined, 1n]) {
      assert.throws(() => run(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "invoked");`, { [field]: value }), /finite positive/u);
      assert.equal(existsSync(marker), false);
    }
  }
});

test("spawn and signal failures never return partial stdout", () => {
  assert.throws(() => run("", { executable: join(root, "not-a-program") }), /ENOENT/u);
  assert.throws(() => run("", { directory: join(root, "no-directory") }), /ENOENT/u);
  assert.throws(() => run("", { executable: "invalid\0executable" }), /null bytes|without null|worker failed/u);
  if (process.platform !== "win32") {
    assert.throws(() => run('process.stdout.write("partial", () => process.kill(process.pid, "SIGKILL"));'), /Exit: SIGKILL/u);
  }
  assert.equal(run('process.stdout.write("fresh");'), "fresh");
});

test("deadlines kill roots and inherited descendants even when SIGTERM is ignored", () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const before = Date.now();
  try {
    assert.throws(() => run(descendantSource(identitiesPath, {
      grandchild: true, action: 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
    }), { timeoutMilliseconds: 1_500 }), /deadline/u);
    assert.ok(Date.now() - before < 10_000);
    expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("output overflow cleans up processes independently of pipe close", () => {
  for (const stream of ["stdout", "stderr"]) {
    const identitiesPath = join(root, `${randomUUID()}.json`);
    try {
      assert.throws(() => run(descendantSource(identitiesPath, {
        action: `process.${stream}.write("x".repeat(32_000)); setInterval(() => {}, 1000);`,
      })), /diagnostic byte limit/u);
      expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
    } finally { cleanRecordedProcesses(identitiesPath); }
  }
});

test("root exit cleans same-group descendants with inherited or ignored pipes", posix, () => {
  for (const stdio of ["inherit", "ignore"]) {
    for (const code of [0, 7]) {
      const identitiesPath = join(root, `${randomUUID()}.json`);
      try {
        const invoke = () => run(descendantSource(identitiesPath, {
          stdio, grandchild: true, action: `process.stdout.write("parent-complete"); process.exitCode = ${code};`,
        }));
        if (code === 0) assert.equal(invoke(), "parent-complete");
        else assert.throws(invoke, /Exit: 7/u);
        expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
      } finally { cleanRecordedProcesses(identitiesPath); }
    }
  }
});

test("escaped pipe holders cannot keep a failed or successful root's query open indefinitely", posix, () => {
  for (const code of [0, 7]) {
    const identitiesPath = join(root, `${randomUUID()}.json`);
    const before = Date.now();
    try {
      assert.throws(() => run(descendantSource(identitiesPath, {
        detached: true, action: `process.stdout.write("incomplete"); process.exitCode = ${code};`,
      }), { timeoutMilliseconds: 1_500 }), code === 0 ? /deadline/u : /Exit: 7[\s\S]*deadline/u);
      assert.ok(Date.now() - before < 10_000);
      const [parent, escaped] = JSON.parse(readFileSync(identitiesPath, "utf8"));
      expectDead([parent]);
      assert.equal(processRunning(escaped), true, "the control must really escape the original group");
    } finally { cleanRecordedProcesses(identitiesPath); }
  }
});

test("an escaped descendant without inherited pipes is explicitly outside group cleanup", posix, () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  try {
    assert.equal(run(descendantSource(identitiesPath, {
      detached: true, stdio: "ignore", action: 'process.stdout.write("root-complete");',
    })), "root-complete");
    const [parent, escaped] = JSON.parse(readFileSync(identitiesPath, "utf8"));
    expectDead([parent]);
    assert.equal(processRunning(escaped), true);
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("Windows root exit either closes inherited pipes or rejects within the deadline", { skip: process.platform !== "win32" }, () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const before = Date.now();
  try {
    let result;
    let failure;
    try {
      result = run(descendantSource(identitiesPath, { action: 'process.stdout.write("root-complete");' }), { timeoutMilliseconds: 1_500 });
    } catch (error) { failure = error; }
    assert.ok(Date.now() - before < 10_000);
    const identities = JSON.parse(readFileSync(identitiesPath, "utf8"));
    expectDead([identities[0]]);
    if (failure === undefined) { assert.equal(result, "root-complete"); expectDead(identities); }
    else assert.match(failure.message, /deadline/u);
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("a closed stdout/stderr pair is not evidence of root completion", () => {
  const marker = join(root, randomUUID());
  assert.throws(() => run(`import { closeSync, writeFileSync } from "node:fs";
closeSync(1); closeSync(2); writeFileSync(${JSON.stringify(marker)}, "pipes closed"); setInterval(() => {}, 1000);`, {
    timeoutMilliseconds: 1_000,
  }), /deadline/u);
  assert.equal(existsSync(marker), true);
});

test("response files and partial stdout cannot publish after native failure", () => {
  for (const action of ['process.exitCode = 7;', 'process.stdout.write("x".repeat(32_000));', 'setInterval(() => {}, 1000);']) {
    const response = join(root, `${randomUUID()}.json`);
    let published = false;
    assert.throws(() => {
      run(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(response)}, '{"evidence":true}'); ${action}`, {
        timeoutMilliseconds: 1_000,
      });
      published = true;
    }, /Exit: 7|diagnostic byte limit|deadline/u);
    assert.equal(existsSync(response), true);
    assert.equal(published, false);
    assert.equal(run('process.stdout.write("new-evidence");'), "new-evidence");
  }
});

test("worker exceptions, rejections, exits and pipe errors all clean up the native root", async () => {
  for (const fault of [
    'throw new Error("injected worker error");',
    'void Promise.reject(new Error("injected worker rejection"));',
    'process.exit(23);',
    'child.stdout.emit("error", new Error("injected stdout error"));',
    'child.stderr.emit("error", new Error("injected stderr error"));',
    'child.stdout.destroy();',
    'child.stderr.destroy();',
  ]) {
    const identitiesPath = join(root, `${randomUUID()}.json`);
    const runner = await fixtureRunner(`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([child.pid]));
  child.once("spawn", () => setImmediate(() => { ${fault} }));
  return child;
};
syncBuiltinESMExports();`);
    try {
      assert.throws(() => runner(command('setInterval(() => {}, 1000);')), /injected|worker exited before completion|closed before EOF/u);
      expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
    } finally { cleanRecordedProcesses(identitiesPath); }
  }
});

test("synchronous worker setup failures report without starting a child", async () => {
  const runner = await fixtureRunner(`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
childProcess.spawn = () => { throw new Error("injected spawn failure"); };
syncBuiltinESMExports();`);
  assert.throws(() => runner(command("")), /injected spawn failure/u);
});

test("deadline exhaustion during worker startup prevents native invocation", async () => {
  const marker = join(root, randomUUID());
  const runner = await fixtureRunner(`
import { workerData } from "node:worker_threads";
const pause = new Int32Array(new SharedArrayBuffer(4));
while (process.hrtime.bigint() <= workerData.deadlineNanoseconds) Atomics.wait(pause, 0, 0, 10);`);
  assert.throws(() => runner(command(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "invoked");`, {
    timeoutMilliseconds: 200,
  })), /deadline before invocation/u);
  assert.equal(existsSync(marker), false);
});

test("cleanup failure preserves native rejection diagnostics and never certifies a live root", posix, async () => {
  for (const denyRoot of [false, true]) {
    const identitiesPath = join(root, `${randomUUID()}.json`);
    const input = command(`
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([process.pid]));
process.stderr.write("native rejection");
${denyRoot ? 'setInterval(() => {}, 1000);' : 'process.exitCode = 7;'}
`, { timeoutMilliseconds: 1_000 });
    const control = isolated(`
import { parentPort, workerData } from "node:worker_threads";
import { runRustNativeCommand } from ${JSON.stringify(new URL("bounded-command.js", protocolRoot).href)};
const originalKill = process.kill.bind(process);
process.kill = (identity, signal) => {
  if (identity < 0 || ${denyRoot}) throw Object.assign(new Error("injected cleanup denial"), { code: "EPERM" });
  return originalKill(identity, signal);
};
try { parentPort.postMessage({ output: runRustNativeCommand(workerData) }); }
catch (error) { parentPort.postMessage({ failure: error.message }); }
`, input);
    try {
      const result = await control.result;
      assert.equal(result.output, undefined);
      assert.match(result.failure, /native rejection/u);
      assert.match(result.failure, /cleanup failed/u);
      assert.match(result.failure, /injected cleanup denial/u);
      if (denyRoot) {
        assert.match(result.failure, /deadline/u);
        assert.match(result.failure, /termination could not be confirmed/u);
      } else assert.match(result.failure, /Exit: 7/u);
      const identities = JSON.parse(readFileSync(identitiesPath, "utf8"));
      if (denyRoot) assert.equal(processRunning(identities[0]), true);
      else expectDead(identities);
    } finally { cleanRecordedProcesses(identitiesPath); }
  }
});

test("an unloadable worker has a finite startup bound even with a one-hour command budget", async () => {
  const runner = await fixtureRunner('import "./missing-worker-dependency.js";', true);
  const before = Date.now();
  assert.throws(() => runner(command("", { timeoutMilliseconds: 3_600_000 })), /watchdog[\s\S]*startup/u);
  assert.ok(Date.now() - before < 10_000);
});

test("the caller watchdog kills a native root even when its worker event loop is blocked", async () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const runner = await fixtureRunner(`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([child.pid]));
  child.once("spawn", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));
  return child;
};
syncBuiltinESMExports();`);
  const before = Date.now();
  try {
    assert.throws(() => runner(command('setInterval(() => {}, 1000);', { timeoutMilliseconds: 500 })), /watchdog/u);
    assert.ok(Date.now() - before < 15_000);
    expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("watchdog cancellation preserves the spawn-to-PID cleanup handoff", async () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const runner = await fixtureRunner(`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { commandOutcome, commandState } from "./bounded-command-state.js";
const state = new Int32Array(workerData.state);
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([child.pid]));
  while (Atomics.load(state, commandState.outcome) === commandOutcome.pending) {
    Atomics.wait(state, commandState.outcome, commandOutcome.pending, 100);
  }
  return child;
};
syncBuiltinESMExports();`);
  try {
    assert.throws(() => runner(command('setInterval(() => {}, 1000);', { timeoutMilliseconds: 500 })), /watchdog/u);
    expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("terminal publication and cancellation are exclusive and failure cannot become success", () => {
  for (const terminal of [commandOutcome.cancelled, commandOutcome.failure, commandOutcome.success]) {
    const memory = commandMemory(sharedInput());
    if (terminal === commandOutcome.cancelled) Atomics.store(memory.state, commandState.outcome, terminal);
    else publishCommandResult(memory, terminal === commandOutcome.success, "first-result");
    publishCommandResult(memory, true, "late-success");
    publishCommandResult(memory, false, "late-failure");
    assert.equal(Atomics.compareExchange(memory.state, commandState.outcome, commandOutcome.pending, commandOutcome.cancelled), terminal);
    assert.equal(Atomics.load(memory.state, commandState.outcome), terminal);
    if (terminal !== commandOutcome.cancelled) {
      assert.equal(memory.error.toString("utf8", 0, Atomics.load(memory.state, commandState.errorBytes)), "first-result");
    }
  }
});

test("malformed shared results and success without cleanup fail closed", async () => {
  for (const [field, value, pattern] of [
    [commandState.stdoutBytes, -1, /invalid diagnostic lengths/u],
    [commandState.stderrBytes, 100_000, /invalid diagnostic lengths/u],
    [commandState.errorBytes, nativeCommandErrorBytes + 1, /invalid diagnostic lengths/u],
    [commandState.phase, commandPhase.watching, /incomplete result/u],
    [commandState.outcome, 99, /incomplete result/u],
  ]) {
    const runner = await fixtureRunner(`
import { workerData } from "node:worker_threads";
import { commandPhase, commandState, commandOutcome, notifyCommandChange } from "./bounded-command-state.js";
const state = new Int32Array(workerData.state);
Atomics.store(state, commandState.phase, commandPhase.finished);
Atomics.store(state, ${field}, ${value});
Atomics.store(state, commandState.outcome, ${field === commandState.outcome ? value : commandOutcome.failure});
notifyCommandChange(state);`, true);
    assert.throws(() => runner(command("")), pattern);
  }
  const runner = await fixtureRunner(`
import { workerData } from "node:worker_threads";
import { commandMemory, commandPhase, commandState, publishCommandResult } from "./bounded-command-state.js";
const memory = commandMemory(workerData);
Atomics.store(memory.state, commandState.phase, commandPhase.finished);
publishCommandResult(memory, true, "");`, true);
  assert.throws(() => runner(command("")), /incomplete result/u);
});

test("overlapping native runs keep outputs, budgets and process groups isolated", async () => {
  const gate = new SharedArrayBuffer(4);
  const records = Array.from({ length: 4 }, () => join(root, `${randomUUID()}.json`));
  const acknowledgements = records.map(path => `${path}.ready`);
  const invocations = records.map((path, index) => {
    const succeeds = index % 2 === 0;
    const input = command(`
import { existsSync, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path)}, JSON.stringify([process.pid]));
const rendezvous = setInterval(() => {
  if (!${JSON.stringify(records)}.every(path => existsSync(path))) return;
  clearInterval(rendezvous);
  writeFileSync(${JSON.stringify(acknowledgements[index])}, "all commands started");
  ${succeeds ? `setTimeout(() => process.stdout.write("output-${index}"), 3000);` : 'setInterval(() => {}, 1000);'}
}, 10);
`, { timeoutMilliseconds: succeeds ? 6_000 : 2_000 });
    return isolated(`
import { parentPort, workerData } from "node:worker_threads";
import { runRustNativeCommand } from ${JSON.stringify(new URL("bounded-command.js", protocolRoot).href)};
Atomics.wait(new Int32Array(workerData.gate), 0, 0, 5000);
try { parentPort.postMessage({ ok: true, value: runRustNativeCommand(workerData.command) }); }
catch (error) { parentPort.postMessage({ ok: false, value: error.message }); }
`, { gate, command: input });
  });
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0);
  try {
    const results = await Promise.all(invocations.map(invocation => invocation.result));
    for (const [index, result] of results.entries()) {
      assert.equal(result.ok, index % 2 === 0);
      if (result.ok) assert.equal(result.value, `output-${index}`);
      else assert.match(result.value, /deadline/u);
      assert.equal(existsSync(acknowledgements[index]), true, "native commands must actually overlap");
      expectDead(JSON.parse(readFileSync(records[index], "utf8")));
    }
  } finally {
    await Promise.all(invocations.map(invocation => invocation.worker.terminate()));
    for (const path of records) cleanRecordedProcesses(path);
  }
});

test("a terminal worker failure without a cleanup attempt still triggers caller cleanup", async () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const runner = await fixtureRunner(`
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { commandMemory, commandPhase, commandState, publishCommandResult } from "./bounded-command-state.js";
const memory = commandMemory(workerData);
const child = spawn(workerData.command.executable, workerData.command.arguments, { detached: process.platform !== "win32", stdio: "ignore" });
writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([child.pid]));
Atomics.store(memory.state, commandState.processId, child.pid);
Atomics.store(memory.state, commandState.phase, commandPhase.finished);
publishCommandResult(memory, false, "injected missing cleanup");`, true);
  try {
    assert.throws(() => runner(command('setInterval(() => {}, 1000);')), /incomplete result/u);
    expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("OS cleanup uses one group/tree attempt, bounded taskkill and explicit root cleanup on errors", async () => {
  for (const platform of ["linux", "win32"]) {
    for (const fault of ["none", "missing", "denied", "timeout", "unavailable"]) {
      const control = isolated(`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
Object.defineProperty(process, "platform", { value: workerData.platform });
for (const key of Object.keys(process.env)) if (key.toLowerCase() === "systemroot") delete process.env[key];
process.env.SystemRoot = "test-windows";
const calls = [];
process.kill = (identity, signal) => {
  calls.push({ kind: "kill", identity, signal });
  if (workerData.fault === "missing") throw Object.assign(new Error("gone"), { code: "ESRCH" });
  if (workerData.fault !== "none" && identity < 0) throw Object.assign(new Error("group denied"), { code: "EPERM" });
  return true;
};
childProcess.spawnSync = (executable, args, options) => {
  calls.push({ kind: "taskkill", executable, args, options });
  if (workerData.fault === "timeout") return { error: Object.assign(new Error("taskkill timeout"), { code: "ETIMEDOUT" }), status: null };
  if (workerData.fault === "unavailable") return { error: Object.assign(new Error("taskkill unavailable"), { code: "ENOENT" }), status: null };
  return { status: workerData.fault === "none" ? 0 : 1 };
};
syncBuiltinESMExports();
const { createCommandCleanupOwner } = await import(${JSON.stringify(new URL("bounded-command-cleanup.js", protocolRoot).href)});
const { commandMemory, commandState } = await import(${JSON.stringify(new URL("bounded-command-state.js", protocolRoot).href)});
const memory = commandMemory(workerData.input);
Atomics.store(memory.state, commandState.processId, 12345);
const owner = createCommandCleanupOwner(memory.state, () => {});
owner.reconcile(true);
owner.reconcile(true);
parentPort.postMessage({ message: owner.failure(), calls, cleanup: Atomics.load(memory.state, commandState.cleanup) });
`, { platform, fault, input: sharedInput() });
      const result = await control.result;
      if (["none", "missing"].includes(fault)) {
        assert.equal(result.message, undefined);
        assert.equal(result.cleanup, commandCleanup.complete);
      } else {
        assert.match(result.message, /cleanup failed/u);
        assert.equal(result.cleanup, commandCleanup.failed);
        assert.ok(result.calls.some(call => call.kind === "kill" && call.identity === 12345 && call.signal === "SIGKILL"));
      }
      if (platform === "win32") {
        const attempts = result.calls.filter(call => call.kind === "taskkill");
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].executable, join("test-windows", "System32", "taskkill.exe"));
        assert.deepEqual(attempts[0].args, ["/pid", "12345", "/T", "/F"]);
        assert.equal(attempts[0].options.timeout, nativeCommandCleanupMilliseconds);
        assert.equal(attempts[0].options.killSignal, "SIGKILL");
        assert.equal(attempts[0].options.stdio, "ignore");
      } else {
        assert.equal(result.calls.filter(call => call.identity === -12345).length, 1);
      }
    }
  }
});

test("native worker failures never require worker-owned OS cleanup", posix, async () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const runner = await fixtureRunner(`
process.kill = () => { throw new Error("worker must not perform OS cleanup"); };`);
  try {
    assert.throws(() => runner(command(`
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([process.pid]));
setInterval(() => {}, 1000);
`, { timeoutMilliseconds: 1_000 })), /deadline/u);
    expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("caller handles an abandoned cleanup request from a blocked worker", async () => {
  const identitiesPath = join(root, `${randomUUID()}.json`);
  const runner = await fixtureRunner(`
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { commandCleanup, commandLaunch, commandPhase, commandState, notifyCommandChange } from "./bounded-command-state.js";
const state = new Int32Array(workerData.state);
const child = spawn(workerData.command.executable, workerData.command.arguments, {
  detached: process.platform !== "win32", stdio: "ignore",
});
writeFileSync(${JSON.stringify(identitiesPath)}, JSON.stringify([child.pid]));
Atomics.store(state, commandState.processId, child.pid);
Atomics.store(state, commandState.launch, commandLaunch.published);
Atomics.store(state, commandState.phase, commandPhase.watching);
Atomics.store(state, commandState.cleanup, commandCleanup.requested);
notifyCommandChange(state);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`, true);
  try {
    assert.throws(() => runner(command('setInterval(() => {}, 1000);', { timeoutMilliseconds: 500 })), /watchdog/u);
    expectDead(JSON.parse(readFileSync(identitiesPath, "utf8")));
  } finally { cleanRecordedProcesses(identitiesPath); }
});

test("one cleanup owner deduplicates repeated requests and retains cleanup failure", async () => {
  const control = isolated(`
import { parentPort, workerData } from "node:worker_threads";
import { createCommandCleanupOwner } from ${JSON.stringify(new URL("bounded-command-cleanup.js", protocolRoot).href)};
import { commandCleanup, commandMemory, commandState, requestCommandCleanup } from ${JSON.stringify(new URL("bounded-command-state.js", protocolRoot).href)};
Object.defineProperty(process, "platform", { value: "linux" });
const memory = commandMemory(workerData);
const { state } = memory;
Atomics.store(state, commandState.processId, 12345);
const attempts = [];
let acknowledgements = 0;
const owner = createCommandCleanupOwner(state, () => { acknowledgements += 1; });
process.kill = (identity, signal) => {
  attempts.push([identity, signal]);
  owner.reconcile(true);
  if (identity < 0) throw Object.assign(new Error("caller tree denial"), { code: "EPERM" });
  return true;
};
owner.reconcile();
const beforeRequest = attempts.length;
requestCommandCleanup(state);
owner.reconcile();
requestCommandCleanup(state);
owner.observe(12345);
owner.reconcile(true);
parentPort.postMessage({ attempts, beforeRequest, acknowledgements, failure: owner.failure(), cleanup: Atomics.load(state, commandState.cleanup) });
`, sharedInput());
  const result = await control.result;
  assert.equal(result.beforeRequest, 0);
  assert.equal(result.acknowledgements, 1);
  assert.deepEqual(result.attempts, [[-12345, "SIGKILL"], [12345, "SIGKILL"]]);
  assert.match(result.failure, /caller tree denial/u);
  assert.equal(result.cleanup, commandCleanup.failed);
});
