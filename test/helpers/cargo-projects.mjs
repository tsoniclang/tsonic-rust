import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repositoryRoot } from "./rust-session-paths.mjs";
import { createTestWorkspace } from "../../../tsonic/test/scripts/test-workspaces.mjs";
import { finishGeneratedCargoProject, generatedCargoOptions } from "./cargo-target-pool.mjs";

const generatedRoot = resolve(repositoryRoot, ".temp/generated");

export function writeGeneratedProject(name, artifacts) {
  const projectRoot = createTestWorkspace(generatedRoot, `${name}-`);
  for (const artifact of artifacts) {
    const filePath = join(projectRoot, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.text);
  }
  return projectRoot;
}

export function runCargo(projectRoot, args, options = {}) {
  const result = spawnSync("cargo", args, generatedCargoOptions(projectRoot, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 300_000,
    ...options,
  }));
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed in ${projectRoot}:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

export function validateGeneratedProject(name, artifacts, { run = false } = {}) {
  const projectRoot = writeGeneratedProject(name, artifacts);
  let failure;
  try {
    runCargo(projectRoot, ["generate-lockfile", "--offline"]);
    for (const artifact of artifacts) {
      if (artifact.path === "Cargo.toml" || artifact.path.endsWith("/Cargo.toml")) {
        runCargo(dirname(join(projectRoot, artifact.path)), ["fmt", "--check"]);
      }
    }
    runCargo(projectRoot, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(projectRoot, ["test", "--locked", "--offline"]);
    if (run) {
      return runCargo(projectRoot, ["run", "--locked", "--offline"]);
    }
    return undefined;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      finishGeneratedCargoProject(projectRoot);
    } catch (cleanup) {
      if (failure !== undefined) throw new AggregateError([failure, cleanup], `${failure.message}\n${cleanup.message}`);
      throw cleanup;
    }
  }
}
