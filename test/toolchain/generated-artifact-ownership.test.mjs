import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { runCargo, writeGeneratedProject } from "../helpers/cargo-projects.mjs";

const observedExecutables = new Set();
const foreignContents = "This target belongs to a different owner.\n";
const foreignTarget = writeGeneratedProject("foreign-cargo-target", [
  { path: "foreign-sentinel.txt", text: foreignContents },
]);
const manifest = `[package]
name = "q109_generated_provenance"
version = "0.0.0"
edition = "2024"
`;

for (const marker of ["first-source", "second-source"]) {
  test(`generated Cargo ${marker} owns its executable despite an inherited foreign target`, { timeout: 300_000 }, () => {
    const childSentinel = `preserved-child-environment-${marker}`;
    const source = `fn main() { println!("${marker}:{}", env!("Q109_CARGO_CHILD_PROVENANCE")); }\n`;
    const project = writeGeneratedProject("cargo-executable-provenance", [
      { path: "Cargo.toml", text: manifest },
      { path: "src/main.rs", text: source },
    ]);
    const previousTarget = process.env.CARGO_TARGET_DIR;
    const previousSentinel = process.env.Q109_CARGO_CHILD_PROVENANCE;
    process.env.CARGO_TARGET_DIR = foreignTarget;
    process.env.Q109_CARGO_CHILD_PROVENANCE = childSentinel;
    try {
      runCargo(project, ["generate-lockfile", "--offline"], { isolated: true });
      const buildArguments = ["build", "--locked", "--offline", "--message-format=json"];
      const build = runCargo(project, buildArguments, { isolated: true });
      writeFileSync(join(project, "cargo-build.jsonl"), build.stdout);
      writeFileSync(join(project, "cargo-build.stderr"), build.stderr);
      const artifacts = build.stdout.split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line))
        .filter(row => row.reason === "compiler-artifact" && typeof row.executable === "string");
      assert.equal(artifacts.length, 1, "one actual executable artifact is recorded by Cargo");
      const executable = realpathSync(artifacts[0].executable);
      const relativeExecutable = relative(join(project, "target"), executable);
      const provenance = {
        marker, project, foreignTarget, executable, buildArguments,
        sourceSha256: createHash("sha256").update(readFileSync(join(project, "src/main.rs"))).digest("hex"),
        executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
        foreignSentinelSha256: createHash("sha256").update(readFileSync(join(foreignTarget, "foreign-sentinel.txt"))).digest("hex"),
      };
      writeFileSync(join(project, "executable-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
      console.log(`Q109 Cargo artifact: ${JSON.stringify(provenance)}`);
      assert.equal(relativeExecutable !== ".." && !relativeExecutable.startsWith(`..${sep}`) && !isAbsolute(relativeExecutable), true,
        "Cargo reports an executable in this project's own target, never the inherited foreign target");
      assert.equal(observedExecutables.has(executable), false, "distinct project source roots never reuse one executable path");
      observedExecutables.add(executable);
      const execution = runCargo(project, ["run", "--locked", "--offline", "--quiet"], { isolated: true });
      writeFileSync(join(project, "cargo-run.stdout"), execution.stdout);
      writeFileSync(join(project, "cargo-run.stderr"), execution.stderr);
      const expectedOutput = `${marker}:${childSentinel}\n`;
      assert.equal(execution.stdout, expectedOutput, "Cargo runs this project's distinct source and preserves other child environment fields");
      const direct = spawnSync(executable, [], { cwd: project, encoding: "utf8", timeout: 120_000 });
      assert.equal(direct.status, 0, "the exact executable reported by Cargo runs successfully");
      assert.equal(direct.stdout, expectedOutput, "direct executable provenance agrees with the Cargo run");
      assert.equal(readFileSync(join(foreignTarget, "foreign-sentinel.txt"), "utf8"), foreignContents,
        "the foreign owner's sentinel bytes remain untouched");
      assert.equal(readdirSync(foreignTarget).sort().join("\n"), "foreign-sentinel.txt",
        "no build, lock or cache output is written to the inherited foreign target");
      assert.equal(process.env.CARGO_TARGET_DIR, foreignTarget, "runCargo never mutates its caller's target setting");
      assert.equal(process.env.Q109_CARGO_CHILD_PROVENANCE, childSentinel, "runCargo never mutates its caller's other environment fields");
      assert.equal(createHash("sha256").update(readFileSync(executable)).digest("hex"), provenance.executableSha256,
        "Cargo run and direct execution use the exact originally recorded executable bytes");
      console.log(`Q109 Cargo execution: ${JSON.stringify({ marker, project, executable, source, manifest,
        cargoStdout: execution.stdout, directStdout: direct.stdout, foreignEntries: readdirSync(foreignTarget),
        foreignSentinel: readFileSync(join(foreignTarget, "foreign-sentinel.txt"), "utf8"), executableSha256: provenance.executableSha256 })}`);
    } finally {
      if (previousTarget === undefined) delete process.env.CARGO_TARGET_DIR;
      else process.env.CARGO_TARGET_DIR = previousTarget;
      if (previousSentinel === undefined) delete process.env.Q109_CARGO_CHILD_PROVENANCE;
      else process.env.Q109_CARGO_CHILD_PROVENANCE = previousSentinel;
    }
  });
}
