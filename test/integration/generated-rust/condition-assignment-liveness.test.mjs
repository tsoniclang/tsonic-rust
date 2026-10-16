import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const source = `
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;
function step(): int32 { calls += 1; return 7; }

function thenRead(limit: int32): boolean {
  calls = 0;
  let value: int32 = 0;
  if ((value = step()) > limit) return value === 7 && calls === 1;
  return calls === 1;
}
function elseRead(limit: int32): boolean {
  calls = 0;
  let value: int32 = 0;
  if ((value = step()) > limit) return calls === 1;
  else return value === 7 && calls === 1;
}
function afterRead(limit: int32): boolean {
  calls = 0;
  let value: int32 = 0;
  if ((value = step()) > limit) calls += 1;
  return value === 7 && calls === (limit < 7 ? 2 : 1);
}
function overwrite(limit: int32): boolean {
  calls = 0;
  let value: int32 = 0;
  if ((value = step()) > limit) {
    value = 11;
    return value === 11 && calls === 1;
  } else {
    value = 13;
    return value === 13 && calls === 1;
  }
}
function readBeforeOverwrite(limit: int32): boolean {
  calls = 0;
  let value: int32 = 0;
  if ((value = step()) > limit) {
    const prior = value;
    value = 11;
    return prior === 7 && value === 11 && calls === 1;
  } else return value === 7 && calls === 1;
}
function earlierRead(): boolean {
  calls = 0;
  let value: int32 = 0;
  if (value + (value = step()) > 0) return calls === 1;
  return false;
}
function laterRead(): boolean {
  calls = 0;
  let value: int32 = 0;
  if ((value = step()) + value > 0) return calls === 1;
  return false;
}
function compound(limit: int32): boolean {
  let count: int32 = 0;
  if ((count += 2) > limit) return count === 2;
  else return count === 2 && limit >= 2;
}
function nullish(limit: int32): boolean {
  calls = 0;
  let value: int32 | undefined = undefined;
  if ((value ??= step()) > limit) return value === 7 && calls === 1;
  else return value === 7 && calls === 1 && limit >= 7;
}
function nullishOverwrite(limit: int32): boolean {
  calls = 0;
  let value: int32 | undefined = undefined;
  if ((value ??= step()) > limit) {
    value = 11;
    return value === 11 && calls === 1;
  } else {
    value = 13;
    return value === 13 && calls === 1;
  }
}
export function run(): boolean {
  return thenRead(0) && thenRead(10) && elseRead(0) && elseRead(10) &&
    afterRead(0) && afterRead(10) && overwrite(0) && overwrite(10) &&
    readBeforeOverwrite(0) && readBeforeOverwrite(10) &&
    earlierRead() && laterRead() && compound(0) && compound(10) &&
    nullish(0) && nullish(10) && nullishOverwrite(0) && nullishOverwrite(10);
}
export function main(): void {
  if (!run()) throw new Error("condition liveness");
}
main();
`;

for (const surface of ["native", "js"]) {
  test(`${surface}: condition stores retain branch reads, overwrite versions and native effect order`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      ...(surface === "native" ? {} : { surfaces: ["js"] }),
      target: { id: "rust", options: { outputType: "bin", crateName: `condition_liveness_${surface}` } },
      files: { "index.ts": source },
    });
    assert.equal(result.diagnostics.length, 0,
      `${surface}: source diagnostics: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
    const project = writeGeneratedProject(`condition-liveness-${surface}`, result.artifacts);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt", "--all", "--check"]);
    runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["build", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(project, ["test", "--locked", "--offline"]);
    assert.equal(runCargo(project, ["run", "--locked", "--offline"]).status, 0,
      `${surface}: all branch, evaluation-count and overwrite controls execute successfully`);
  });
}
