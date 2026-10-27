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
import { generatedCargoOptions } from ${JSON.stringify(poolModule)};
const root = process.argv[1];
process.env.CARGO_TARGET_DIR = root + "/foreign";
const original = process.env.CARGO_TARGET_DIR;
const first = generatedCargoOptions(root + "/not-created", ["generate-lockfile"], { timeout: 1234 });
const build = generatedCargoOptions(root + "/not-created", ["build"], { timeout: 1234 });
const again = generatedCargoOptions(root + "/not-created", ["check"], { timeout: 1234 });
const release = generatedCargoOptions(root + "/not-created", ["test", "--release"]);
const nextProject = generatedCargoOptions(root + "/other-not-created", ["build"]);
const isolated = generatedCargoOptions(root, ["build"], { isolated: true, timeout: 1234 });
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
import { runCargo } from ${JSON.stringify(cargoModule)};
import { finishGeneratedCargoProject, generatedCargoOptions } from ${JSON.stringify(poolModule)};
const [first, second] = process.argv.slice(1);
runCargo(first, ["generate-lockfile", "--offline"]);
runCargo(first, ["build", "--locked", "--offline"]);
runCargo(first, ["build", "--release", "--locked", "--offline"]);
const target = generatedCargoOptions(first, []).env.CARGO_TARGET_DIR;
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
import { validateGeneratedProject } from ${JSON.stringify(cargoModule)};
let failure;
try {
  validateGeneratedProject("invalid-pool-manifest", [{ path: "Cargo.toml", text: "[invalid manifest" }]);
} catch (error) { failure = error; }
assert.equal(failure instanceof AggregateError, true);
assert.equal(failure.errors.length, 2);
assert.match(failure.errors[0].message, /cargo generate-lockfile --offline failed/);
assert.match(failure.message, /cargo generate-lockfile --offline failed/);
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
  const cargoPidFile = join(directory, "cargo.pid");
  project(native, "pool_descendant", "fn main() {}\n");
  writeFileSync(join(native, "build.rs"), `
fn main() {
    let lock = std::fs::read_link("/proc/self/fd/3").expect("build script inherits the slot lock");
    assert!(lock.file_name().unwrap().to_string_lossy().starts_with("slot-"));
    assert!(lock.to_string_lossy().ends_with(".lock"));
    let child = std::process::Command::new("bash").arg("-c").arg(${JSON.stringify(`printf '{"build":%s,"child":%s}' "$PPID" "$$" > '${marker}'; while [ ! -f '${release}' ]; do sleep 0.05; done`)}).spawn().unwrap();
    let status = child.wait_with_output().unwrap().status;
    assert!(status.success());
}
`);
  const script = join(directory, "owner.mjs");
  writeFileSync(script, `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { generatedCargoOptions } from ${JSON.stringify(poolModule)};
test("native owner", async () => {
  const native = ${JSON.stringify(native)};
  const options = generatedCargoOptions(native, ["build"], { cwd: native });
  const cargo = spawn("cargo", ["build", "--offline"], options);
  writeFileSync(${JSON.stringify(cargoPidFile)}, JSON.stringify({ pid: cargo.pid, target: options.env.CARGO_TARGET_DIR }));
  cargo.stdout.resume(); cargo.stderr.pipe(process.stderr);
  await new Promise((resolve, reject) => cargo.on("exit", code => code === 0 ? resolve() : reject(new Error("cargo exited " + code))));
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
    const cargoOwner = JSON.parse(readFileSync(cargoPidFile, "utf8"));
    const lock = `${cargoOwner.target}.lock`;
    const attempt = () => spawnSync("flock", ["--nonblock", lock, "true"], { timeout: 10_000 }).status;
    assert.equal(attempt(), 1, "a second process cannot enter a live owner's slot");
    owner.kill("SIGKILL");
    await ownerExit;
    assert.equal(attempt(), 1, "dead Node PID does not release a slot still inherited by Cargo");
    process.kill(cargoOwner.pid, "SIGKILL");
    assert.equal(attempt(), 1, "Cargo death does not release its live build-script descendant's lock");
    process.kill(nativePids.build, "SIGKILL");
    assert.equal(attempt(), 1, "the native grandchild still owns the inherited descriptor");
    writeFileSync(release, "done");
    await waitFor(() => attempt() === 0, "the kernel releases the lock only after the native grandchild exits");
  } finally {
    writeFileSync(release, "done");
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    if (nativePids !== undefined) {
      for (const pid of [nativePids.child, nativePids.build, JSON.parse(readFileSync(cargoPidFile, "utf8")).pid]) {
        try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
  }
});
