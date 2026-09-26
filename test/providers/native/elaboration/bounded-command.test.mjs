import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";

const root = createTestWorkspace("rust-native-command-bounds");

function run(source, options = {}) {
  const path = join(root, `${crypto.randomUUID()}.mjs`);
  writeFileSync(path, source);
  return runRustNativeCommand({
    executable: process.execPath, arguments: [path], directory: root,
    environment: process.env, timeoutMilliseconds: 1_000, maximumDiagnosticBytes: 16 * 1024,
    ...options,
  });
}

test("native commands return bounded complete stdout and retain failure diagnostics", () => {
  assert.equal(run('process.stdout.write("complete\\n");'), "complete");
  assert.throws(() => run('process.stderr.write("native rejection"); process.exit(7);'), /native rejection[\s\S]*Exit: 7/u);
  assert.throws(() => run('process.stdout.write("x".repeat(32_000));'), /diagnostic byte limit/u);
  assert.throws(() => run('process.stderr.write("x".repeat(32_000));'), /diagnostic byte limit/u);
  assert.throws(() => run("", { executable: join(root, "not-a-program") }), /ENOENT/u);
});

test("native command watchdog bounds a hang and terminates inherited children", () => {
  const pidFile = join(root, "child.json");
  const before = Date.now();
  assert.throws(() => run(`
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`, { timeoutMilliseconds: 500 }), /deadline/u);
  assert.ok(Date.now() - before < 10_000);
  const identities = JSON.parse(readFileSync(pidFile, "utf8"));
  for (const identity of [identities.parent, identities.child]) {
    const deadline = Date.now() + 5_000;
    while (processRunning(identity) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    assert.equal(processRunning(identity), false, `native child ${identity} remains active`);
  }
});

test("native command budgets fail before invocation for nonfinite or inconsistent input", () => {
  for (const field of ["timeoutMilliseconds", "maximumDiagnosticBytes"]) {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => run("", { [field]: value }), /finite positive/u);
    }
  }
});

function processRunning(identity) {
  try { process.kill(identity, 0); }
  catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  if (process.platform === "linux") {
    const status = `/proc/${identity}/stat`;
    if (!existsSync(status)) return false;
    const fields = readFileSync(status, "utf8");
    return fields.slice(fields.lastIndexOf(")") + 2, fields.lastIndexOf(")") + 3) !== "Z";
  }
  return true;
}
