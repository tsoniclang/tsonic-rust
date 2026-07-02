// Writes generated artifacts into .temp/generated/<name> and validates them
// with the real cargo toolchain.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repositoryRoot } from "./rust-session.mjs";

const generatedRoot = resolve(repositoryRoot, ".temp/generated");

export function writeGeneratedProject(name, artifacts) {
  const projectRoot = join(generatedRoot, name);
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(projectRoot, { recursive: true });
  for (const artifact of artifacts) {
    const filePath = join(projectRoot, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.text);
  }
  return projectRoot;
}

export function runCargo(projectRoot, args) {
  const result = spawnSync("cargo", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
    timeout: 300_000,
  });
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed in ${projectRoot}:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

export function validateGeneratedProject(name, artifacts, { run = false } = {}) {
  const projectRoot = writeGeneratedProject(name, artifacts);
  runCargo(projectRoot, ["generate-lockfile", "--offline"]);
  runCargo(projectRoot, ["fmt", "--all", "--check"]);
  runCargo(projectRoot, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(projectRoot, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(projectRoot, ["test", "--locked", "--offline"]);
  if (run) {
    return runCargo(projectRoot, ["run", "--locked", "--offline"]);
  }
  return undefined;
}
