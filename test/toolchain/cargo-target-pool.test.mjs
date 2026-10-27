import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createTestWorkspace } from "../../../tsonic/test/scripts/test-workspaces.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const poolModule = new URL("../helpers/cargo-target-pool.mjs", import.meta.url).href;
const cargoModule = new URL("../helpers/cargo-projects.mjs", import.meta.url).href;
const environment = { ...process.env, TSONIC_CARGO_POOL_SIZE: process.env.TSONIC_CARGO_POOL_SIZE ?? "8",
  CARGO_BUILD_JOBS: "1", RUST_TEST_THREADS: "1" };

function scratch(name) {
  return createTestWorkspace(join(root, ".temp"), `cargo-pool-${name}-`);
}

function runChild(source, args = []) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source, ...args], {
    env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.error === undefined, true, `child completed: ${result.error?.message ?? ""}`);
  assert.equal(result.signal, null, "child was not interrupted");
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("POOL_RESULT="));
  assert.equal(line !== undefined, true, "child reports its exact native pool evidence");
  return JSON.parse(line.slice("POOL_RESULT=".length));
}

function project(directory, name, body, dependency) {
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "Cargo.toml"), `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2024"\n${dependency ?? ""}`);
  writeFileSync(join(directory, "src/main.rs"), body);
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 60_000;
  while (!predicate()) {
    assert.equal(Date.now() < deadline, true, label);
    await delay(20);
  }
}

test("generated Cargo options preserve isolation and extend only each project's first compiling call per profile", () => {
  const directory = scratch("options");
  const observed = runChild(`
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const calls = [];
const nativeSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  if (command !== "cargo") return nativeSpawnSync(command, args, options);
  calls.push(options);
  return { status: 0, signal: null, stdout: "", stderr: "" };
};
syncBuiltinESMExports();
const pool = await import(${JSON.stringify(poolModule)});
const { spawnGeneratedCargo } = pool;
assert.equal("generatedCargoOptions" in pool, false);
const root = process.argv[1];
process.env.CARGO_TARGET_DIR = root + "/foreign";
const original = process.env.CARGO_TARGET_DIR;
spawnGeneratedCargo(root + "/not-created", ["generate-lockfile"], { timeout: 1234 });
spawnGeneratedCargo(root + "/not-created", ["build"], { timeout: 1234 });
spawnGeneratedCargo(root + "/not-created", ["check"], { timeout: 1234 });
spawnGeneratedCargo(root + "/not-created", ["test", "--release"]);
spawnGeneratedCargo(root + "/other-not-created", ["build"]);
spawnGeneratedCargo(root, ["build"], { isolated: true, timeout: 1234 });
const [first, build, again, release, nextProject, isolated] = calls;
assert.equal(process.env.CARGO_TARGET_DIR, original);
assert.equal(first.timeout, 1234);
assert.equal(build.timeout, 900000);
assert.equal(again.timeout, 1234);
assert.equal(release.timeout, 900000);
assert.equal(nextProject.timeout, 900000);
assert.equal(build.env.CARGO_INCREMENTAL, "0");
assert.equal(isolated.env.CARGO_TARGET_DIR, undefined);
assert.equal(isolated.timeout, 1234);
assert.equal(isolated.stdio, undefined);
assert.equal(build.env.CARGO_TARGET_DIR === original, false);
assert.equal(build.stdio[3] === first.stdio[3], true);
console.log("POOL_RESULT=" + JSON.stringify({ target: build.env.CARGO_TARGET_DIR, unchanged: true }));
`, [directory]);
  assert.equal(observed.unchanged, true, "the caller environment and explicit isolated budget remain unchanged");
  assert.equal(dirname(observed.target), join(root, ".temp/cargo-target-pool"), "the checkout owns the selected target");
  assert.match(basename(observed.target), /^slot-\d+$/u, "the actual free slot is selected without depending on other workers");
});

test("one generated project keeps build/run identity and cleanup preserves shared dependency artifacts", () => {
  const directory = scratch("sequence");
  const dependency = join(directory, "dependency");
  mkdirSync(join(dependency, "src"), { recursive: true });
  writeFileSync(join(dependency, "Cargo.toml"), '[package]\nname="pool_shared_dependency"\nversion="0.0.0"\nedition="2024"\n');
  writeFileSync(join(dependency, "src/lib.rs"), 'pub fn value() -> i32 { 17 }\n');
  const first = join(directory, "first");
  const second = join(directory, "second");
  const manifest = `[dependencies]\npool_shared_dependency={path=${JSON.stringify(dependency)}}\n`;
  project(first, "pool_generated", 'fn main(){println!("first:{}",pool_shared_dependency::value());}\n', manifest);
  project(second, "pool_generated", 'fn main(){println!("second:{}",pool_shared_dependency::value());}\n', manifest);
  const observed = runChild(`
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
let target;
const nativeSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  if (command === "cargo") target = options.env.CARGO_TARGET_DIR;
  return nativeSpawnSync(command, args, options);
};
syncBuiltinESMExports();
const { runCargo } = await import(${JSON.stringify(cargoModule)});
const { finishGeneratedCargoProject } = await import(${JSON.stringify(poolModule)});
const [first, second] = process.argv.slice(1);
runCargo(first, ["generate-lockfile", "--offline"]);
runCargo(first, ["build", "--locked", "--offline"]);
runCargo(first, ["build", "--release", "--locked", "--offline"]);
assert.equal(existsSync(join(target, "debug/pool_generated")), true);
assert.equal(existsSync(join(target, "release/pool_generated")), true);
assert.equal(runCargo(first, ["run", "--locked", "--offline", "--quiet"]).stdout, "first:17\\n");
finishGeneratedCargoProject(first);
assert.equal(existsSync(join(target, "debug/pool_generated")), false);
assert.equal(existsSync(join(target, "release/pool_generated")), false);
const dependencies = readdirSync(join(target, "debug/deps")).filter(name => name.startsWith("libpool_shared_dependency-") && name.endsWith(".rlib"));
assert.equal(dependencies.length > 0, true);
assert.equal(runCargo(second, ["run", "--offline", "--quiet"]).stdout, "second:17\\n");
finishGeneratedCargoProject(second);
assert.equal(existsSync(join(target, "debug/pool_generated")), false);
assert.equal(dependencies.every(name => existsSync(join(target, "debug/deps", name))), true);
console.log("POOL_RESULT=" + JSON.stringify({ dependencies: dependencies.length, second: true }));
`, [first, second]);
  assert.equal(observed.dependencies > 0, true, "cleanup preserves the actual built shared dependency");
  assert.equal(observed.second, true, "same-name projects execute their own distinct source before cleanup");
});

test("a native failure retains its original diagnostics when generated-package cleanup also fails", () => {
  const observed = runChild(`
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const nativeSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  const result = nativeSpawnSync(command, args, options);
  if (command === "cargo" && args[0] === "clippy" && result.status !== 0) {
    writeFileSync(join(options.cwd, "Cargo.toml"), "[invalid manifest");
  }
  return result;
};
syncBuiltinESMExports();
const { validateGeneratedProject } = await import(${JSON.stringify(cargoModule)});
let failure;
try {
  validateGeneratedProject("invalid-pool-manifest", [
    { path: "Cargo.toml", text: '[package]\\nname="pool_compile_error"\\nversion="0.0.0"\\nedition="2024"\\n' },
    { path: "src/lib.rs", text: 'pub fn invalid() -> u32 {\\n    true\\n}\\n' },
  ]);
} catch (error) { failure = error; }
assert.equal(failure instanceof AggregateError, true);
assert.equal(failure.errors.length, 2);
assert.match(failure.errors[0].message, /cargo clippy --all-targets --locked --offline -- -D warnings failed/);
assert.match(failure.message, /E0308/);
assert.match(failure.message, /Generated Cargo package metadata failed/);
console.log("POOL_RESULT=" + JSON.stringify({ retained: true }));
`);
  assert.equal(observed.retained, true, "cleanup cannot replace or suppress the original Cargo failure");
});

test("the slot remains kernel locked through Cargo and build-script descendants after the Node owner is killed", async () => {
  const directory = scratch("descendants");
  const native = join(directory, "native");
  const marker = join(directory, "native-pids.json");
  const release = join(directory, "release");
  project(native, "pool_descendant", "fn main() {}\n");
  writeFileSync(join(native, "build.rs"), `
fn main() {
    let lock = std::fs::read_link("/proc/self/fd/3").expect("build script inherits the slot lock");
    assert!(lock.file_name().unwrap().to_string_lossy().starts_with("slot-"));
    assert!(lock.to_string_lossy().ends_with(".lock"));
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap();
    let cargo = stat.rsplit_once(')').unwrap().1.split_whitespace().nth(1).unwrap();
    let target = std::env::var("CARGO_TARGET_DIR").unwrap();
    let child = std::process::Command::new("bash").arg("-c").arg(${JSON.stringify(`printf '{"build":%s,"child":%s,"cargo":%s,"target":"%s"}' "$PPID" "$$" "$POOL_CARGO_PID" "$CARGO_TARGET_DIR" > '${marker}'; while [ ! -f '${release}' ]; do sleep 0.05; done`)}).env("POOL_CARGO_PID", cargo).spawn().unwrap();
    assert!(!target.is_empty());
    let status = child.wait_with_output().unwrap().status;
    assert!(status.success());
}
`);
  const script = join(directory, "owner.mjs");
  writeFileSync(script, `
import test from "node:test";
import { spawnGeneratedCargo } from ${JSON.stringify(poolModule)};
test("native owner", () => {
  const native = ${JSON.stringify(native)};
  const result = spawnGeneratedCargo(native, ["build", "--offline"], { cwd: native, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
});
`);
  const owner = spawn(process.execPath, [script], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  owner.stdout.resume();
  owner.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-16_384); });
  const ownerExit = once(owner, "exit");
  let nativePids;
  try {
    await waitFor(() => {
      assert.equal(owner.exitCode, null, `Cargo's owner remains live until its native child starts: ${stderr}`);
      return existsSync(marker);
    }, "Cargo and its native build-script child become live");
    nativePids = JSON.parse(readFileSync(marker, "utf8"));
    const lock = `${nativePids.target}.lock`;
    const attempt = () => spawnSync("flock", ["--nonblock", lock, "true"], { timeout: 10_000 }).status;
    assert.equal(attempt(), 1, "a second process cannot enter a live owner's slot");
    owner.kill("SIGKILL");
    await ownerExit;
    assert.equal(attempt(), 1, "dead Node PID does not release a slot still inherited by Cargo");
    process.kill(nativePids.cargo, "SIGKILL");
    assert.equal(attempt(), 1, "Cargo death does not release its live build-script descendant's lock");
    process.kill(nativePids.build, "SIGKILL");
    assert.equal(attempt(), 1, "the native grandchild still owns the inherited descriptor");
    writeFileSync(release, "done");
    await waitFor(() => attempt() === 0, "the kernel releases the lock only after the native grandchild exits");
  } finally {
    writeFileSync(release, "done");
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
  }
});

test("a timed-out Cargo owner abandons its locked slot without cleaning or reusing native descendant artifacts", async () => {
  const directory = scratch("timeout");
  const native = join(directory, "native");
  const next = join(directory, "next");
  const marker = join(directory, "native.json");
  const report = join(directory, "owner.json");
  const releaseNative = join(directory, "release-native");
  const releaseOwner = join(directory, "release-owner");
  project(native, "pool_timeout", "fn main() {}\n");
  project(next, "pool_after_timeout", 'fn main() { println!("{}", std::env::var("CARGO_TARGET_DIR").unwrap()); }\n');
  const script = join(directory, "owner.mjs");
  writeFileSync(script, `
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { finishGeneratedCargoProject, spawnGeneratedCargo } from ${JSON.stringify(poolModule)};
test("live timeout owner", async () => {
  const native = ${JSON.stringify(native)};
  const options = { cwd: native, encoding: "utf8", timeout: 3000 };
  assert.equal(spawnGeneratedCargo(native, ["build", "--offline"], options).status, 0);
  writeFileSync(join(native, "build.rs"), ${JSON.stringify(`
unsafe extern "C" { fn close(fd: i32) -> i32; }
fn main() {
    let target = std::env::var("CARGO_TARGET_DIR").unwrap();
    assert!(std::fs::read_link("/proc/self/fd/3").unwrap().to_string_lossy().ends_with(".lock"));
    let mut child = std::process::Command::new("bash")
        .arg("-c").arg(${JSON.stringify(`while [ ! -f '${releaseNative}' ]; do sleep 0.05; done`)})
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().unwrap();
    std::fs::write(${JSON.stringify(marker)}, &target).unwrap();
    unsafe { close(1); close(2); }
    assert!(child.wait().unwrap().success());
}
`)});
  const interrupted = spawnGeneratedCargo(native, ["build", "--offline"], options);
  assert.equal(interrupted.error?.code, "ETIMEDOUT");
  assert.equal(interrupted.signal, "SIGTERM");
  const old = readFileSync(${JSON.stringify(marker)}, "utf8");
  assert.equal(existsSync(join(old, "debug/pool_timeout")), true);
  finishGeneratedCargoProject(native);
  assert.equal(existsSync(join(old, "debug/pool_timeout")), true);
  const fresh = spawnGeneratedCargo(${JSON.stringify(next)}, ["run", "--offline", "--quiet"],
    { cwd: ${JSON.stringify(next)}, encoding: "utf8", timeout: 300000 });
  assert.equal(fresh.status, 0, fresh.stderr);
  const current = fresh.stdout.trim();
  assert.notEqual(current, old);
  finishGeneratedCargoProject(${JSON.stringify(next)});
  assert.equal(existsSync(join(old, "debug/pool_timeout")), true);
  writeFileSync(${JSON.stringify(report)}, JSON.stringify({ old, current }));
  const deadline = Date.now() + 60000;
  while (!existsSync(${JSON.stringify(releaseOwner)})) {
    assert.equal(Date.now() < deadline, true, "owner release remains bounded");
    await delay(20);
  }
});
`);
  const owner = spawn(process.execPath, [script], {
    env: { ...environment, TSONIC_CARGO_POOL_SIZE: String(Math.max(2, Number(environment.TSONIC_CARGO_POOL_SIZE))) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  owner.stdout.on("data", chunk => { output = (output + chunk).slice(-16_384); });
  owner.stderr.on("data", chunk => { output = (output + chunk).slice(-16_384); });
  const ownerExit = once(owner, "exit");
  try {
    await waitFor(() => {
      assert.equal(owner.exitCode, null, `the interrupted Cargo's Node owner remains live: ${output}`);
      return existsSync(report);
    }, "the live owner times out and completes a later call in a fresh slot");
    const observed = JSON.parse(readFileSync(report, "utf8"));
    assert.notEqual(observed.old, observed.current, "the interrupted slot is not reused by the same owner");
    const attempt = () => spawnSync("flock", ["--nonblock", `${observed.old}.lock`, "true"], { timeout: 10_000 }).status;
    assert.equal(attempt(), 1, "native descendants retain the old kernel lock after Cargo's timeout");
    const blocked = spawnSync("flock", ["--nonblock", `${observed.old}.lock`, "cargo", "clean", "--offline",
      "--target-dir", observed.old, "--package", "pool_timeout"], { cwd: native, encoding: "utf8", timeout: 30_000 });
    assert.equal(blocked.status, 1, "locked-slot cleanup cannot start");
    assert.equal(existsSync(join(observed.old, "debug/pool_timeout")), true, "neither owner cleanup nor external cleanup removes the live slot's artifact");
    writeFileSync(releaseNative, "done");
    await waitFor(() => attempt() === 0, "native descendants exit and the kernel releases the abandoned slot");
    assert.equal(existsSync(join(observed.old, "debug/pool_timeout")), true, "abandonment is not deferred deletion");
    const cleaned = spawnSync("flock", ["--nonblock", `${observed.old}.lock`, "cargo", "clean", "--offline",
      "--target-dir", observed.old, "--package", "pool_timeout"], { cwd: native, encoding: "utf8", timeout: 30_000 });
    assert.equal(cleaned.status, 0, cleaned.stderr);
    assert.equal(existsSync(join(observed.old, "debug/pool_timeout")), false, "post-drain cleanup takes the released kernel lock first");
    writeFileSync(releaseOwner, "done");
    const [status, signal] = await ownerExit;
    assert.equal(status, 0, output);
    assert.equal(signal, null, "the original Node owner remained alive throughout the timeout witness");
  } finally {
    writeFileSync(releaseNative, "done");
    writeFileSync(releaseOwner, "done");
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
  }
});
