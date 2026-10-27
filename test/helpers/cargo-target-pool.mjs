import { spawnSync } from "node:child_process";
import { after, afterEach } from "node:test";
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, writeSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { repositoryRoot } from "./rust-session-paths.mjs";

const projects = new Map();
const abandoned = new Set();
const pause = new Int32Array(new SharedArrayBuffer(4));
let lease;

export function spawnGeneratedCargo(projectRoot, args, { isolated = false, binary, ...options } = {}) {
  const environment = { ...(options.env ?? process.env), CARGO_TERM_COLOR: "never", CARGO_INCREMENTAL: "0" };
  if (isolated) {
    delete environment.CARGO_TARGET_DIR;
    return spawnSync(binary === undefined ? "cargo" : join(projectRoot, "target", binary), args,
      { ...options, env: environment });
  }
  const owned = acquireSlot();
  const root = resolve(projectRoot);
  let project = projects.get(root);
  if (project === undefined) {
    project = { profiles: new Set(), directory: owned.directory };
    projects.set(root, project);
  }
  const compiles = binary === undefined && ["build", "check", "clippy", "rustc", "test", "run", "bench"].includes(args[0]);
  const profileIndex = args.indexOf("--profile");
  const profile = profileIndex >= 0 ? args[profileIndex + 1]
    : args.find(argument => argument.startsWith("--profile="))?.slice("--profile=".length)
      ?? (args.includes("--release") || args[0] === "bench" ? "release" : "dev");
  const cold = compiles && !project.profiles.has(profile);
  if (compiles) project.profiles.add(profile);
  return spawnInSlot(owned, binary === undefined ? "cargo" : join(owned.directory, binary), args, {
    ...options,
    env: { ...environment, CARGO_TARGET_DIR: owned.directory },
    timeout: cold ? Math.max(options.timeout ?? 300_000, 900_000) : options.timeout ?? 300_000,
  });
}

export function finishGeneratedCargoProject(projectRoot) {
  const root = resolve(projectRoot);
  const project = projects.get(root);
  if (project === undefined) return;
  projects.delete(root);
  if (project.profiles.size === 0 || !existsSync(join(root, "Cargo.toml"))) {
    return;
  }
  if (abandoned.has(project.directory)) return;
  closeLease();
  const owned = lockSlot(project.directory);
  if (owned === undefined) {
    abandonSlot({ directory: project.directory });
    return;
  }
  lease = owned;
  const options = {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CARGO_TARGET_DIR: owned.directory, CARGO_INCREMENTAL: "0", CARGO_TERM_COLOR: "never" },
  };
  const metadata = spawnInSlot(owned, "cargo", ["metadata", "--no-deps", "--format-version=1", "--offline"], options);
  if (metadata.status !== 0) {
    throw new Error(`Generated Cargo package metadata failed in ${root}: ${metadata.error?.message ?? ""}\n${metadata.stderr}`);
  }
  const graph = JSON.parse(metadata.stdout);
  const members = new Set(graph.workspace_members);
  const packages = graph.packages.filter(package_ => {
    const path = relative(root, package_.manifest_path);
    return members.has(package_.id) && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
  });
  if (packages.length !== 0) {
    for (const profile of project.profiles) {
      const cleaned = spawnInSlot(owned, "cargo", ["clean", "--offline", "--target-dir", owned.directory, "--profile", profile,
        ...packages.flatMap(package_ => ["--package", package_.id])], options);
      if (cleaned.status !== 0) {
        throw new Error(`Generated Cargo package cleanup failed in ${root}: ${cleaned.error?.message ?? ""}\n${cleaned.stderr}`);
      }
    }
  }
}

function acquireSlot() {
  if (lease !== undefined) return lease;
  const count = Number(process.env.TSONIC_CARGO_POOL_SIZE ?? "8");
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("TSONIC_CARGO_POOL_SIZE must be a positive integer.");
  const pool = join(repositoryRoot, ".temp/cargo-target-pool");
  mkdirSync(pool, { recursive: true });
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    for (let index = 0; index < count; index++) {
      const directory = join(pool, `slot-${index}`);
      if (abandoned.has(directory)) continue;
      const owned = lockSlot(directory);
      if (owned === undefined) continue;
      lease = owned;
      return lease;
    }
    if (abandoned.size >= count) throw new Error("All generated Cargo slots were abandoned after interrupted native calls.");
    Atomics.wait(pause, 0, 0, 25);
  }
  throw new Error("Timed out waiting for an exclusively owned generated Cargo target slot.");
}

function lockSlot(directory) {
  const descriptor = openSync(`${directory}.lock`, "a+", 0o600);
  const locked = spawnSync("flock", ["--nonblock", "3"], {
    encoding: "utf8", timeout: 10_000, stdio: ["ignore", "ignore", "pipe", descriptor],
  });
  if (locked.status === 0) {
    try {
      ftruncateSync(descriptor, 0);
      writeSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      return { descriptor, directory };
    } catch (error) {
      closeSync(descriptor);
      throw error;
    }
  }
  closeSync(descriptor);
  if (locked.status !== 1 || locked.error !== undefined || locked.signal !== null) {
    throw new Error(`Cannot acquire generated Cargo slot: ${locked.error?.message ?? ""}\n${locked.stderr}`);
  }
  return undefined;
}

function closeLease() {
  if (lease === undefined) return;
  closeSync(lease.descriptor);
  lease = undefined;
}

function abandonSlot(owned) {
  abandoned.add(owned.directory);
  for (const [root, project] of projects) {
    if (project.directory === owned.directory) projects.delete(root);
  }
  if (lease?.directory === owned.directory) closeLease();
}

function spawnInSlot(owned, command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: ["pipe", "pipe", "pipe", owned.descriptor] });
  if (result.error?.code === "ETIMEDOUT" || result.signal !== null && result.signal !== undefined) abandonSlot(owned);
  return result;
}

function finishProjects() {
  for (const root of projects.keys()) finishGeneratedCargoProject(root);
}

afterEach(finishProjects);
after(finishProjects);
process.once("exit", () => {
  try {
    finishProjects();
  } catch (error) {
    process.stderr.write(`Generated Cargo cleanup failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    closeLease();
  }
});
