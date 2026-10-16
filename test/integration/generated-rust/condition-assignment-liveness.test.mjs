import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const source = `
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;
function step(): int32 { calls += 1; return 7; }
function hasNoCalls(): boolean { return calls === 0; }

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
function loopBreak(): boolean {
  calls = 0;
  let value: int32 = 0;
  while (true) { if (hasNoCalls()) { value = step(); break; } }
  return value === 7 && calls === 1;
}
function labeledBreak(): boolean {
  calls = 0;
  let value: int32 = 0;
  scan: while (true) { if (hasNoCalls()) { value = step(); break scan; } }
  return value === 7 && calls === 1;
}
function outerBreak(): boolean {
  calls = 0;
  let value: int32 = 0;
  let count: int32 = 0;
  outer: while (count < 3) {
    count += 1;
    if (count > 0) {
      let inner: int32 = 0;
      while (inner < 3) {
        inner += 1;
        if (inner === 2) { value = step(); break outer; }
      }
    }
  }
  return value === 7 && calls === 1;
}
function loopContinue(): boolean {
  calls = 0;
  let value: int32 = 0;
  while (value < 7) { value = step(); continue; }
  return value === 7 && calls === 1;
}
function labeledContinue(): boolean {
  calls = 0;
  let value: int32 = 0;
  scan: while (value < 7) {
    let inner: int32 = 0;
    while (inner < 2) {
      inner += 1;
      if (inner === 1) { value = step(); continue scan; }
    }
  }
  return value === 7 && calls === 1;
}
function switchBreak(selected: int32): boolean {
  calls = 0;
  let value: int32 = 0;
  switch (selected) {
    case 0: value = step(); break;
    case 1: value = step() + 1; break;
    default: value = 13;
  }
  return value === (selected === 0 ? 7 : selected === 1 ? 8 : 13) && calls === (selected < 2 ? 1 : 0);
}
function stringBreak(values: string[]): boolean {
  let visited = "before";
  if (visited !== "before") return false;
  for (const value of values) { visited = value; break; }
  return visited === "x";
}
function regionBreak(): boolean {
  calls = 0;
  let value: int32 = 0;
  region: { value = step(); break region; }
  return value === 7 && calls === 1;
}
function deadExits(): boolean {
  calls = 0;
  let value: int32 = 0;
  if (value !== 0) return false;
  while (true) { value = step(); if (calls > 0) break; }
  value = 11;
  if (value !== 11) return false;
  scan: while (true) { value = step(); if (calls > 0) break scan; }
  value = 13;
  if (value !== 13) return false;
  region: { value = step(); break region; }
  value = 17;
  if (value !== 17) return false;
  let count: int32 = 0;
  while (count < 1) { value = step(); count += 1; continue; }
  value = 19;
  return value === 19 && count === 1 && calls === 4;
}
function parameterOverwrite(value: int32, early: boolean): boolean {
  calls = 0;
  if (value !== 0) return false;
  value = step();
  if (early) return calls === 1;
  value = 23;
  return value === 23 && calls === 1;
}
export function run(): boolean {
  return thenRead(0) && thenRead(10) && elseRead(0) && elseRead(10) &&
    afterRead(0) && afterRead(10) && overwrite(0) && overwrite(10) &&
    readBeforeOverwrite(0) && readBeforeOverwrite(10) &&
    earlierRead() && laterRead() && compound(0) && compound(10) &&
    nullish(0) && nullish(10) && nullishOverwrite(0) && nullishOverwrite(10) &&
    loopBreak() && labeledBreak() && outerBreak() && loopContinue() && labeledContinue() &&
    switchBreak(0) && switchBreak(1) && switchBreak(2) && stringBreak(["x", "y", "z"]) && regionBreak() &&
    deadExits() && parameterOverwrite(0, false) && parameterOverwrite(0, true);
}
export function main(): void {
  if (!run()) throw new Error("condition liveness");
}
main();
`;

function validateControl(surface, text, name) {
  const { result } = compileRust({
    ...(surface === "native" ? {} : { surfaces: ["js"] }),
    target: { id: "rust", options: { outputType: "bin", crateName: name } },
    files: { "index.ts": text },
  });
  assert.equal(result.diagnostics.length, 0,
    `${surface}: source diagnostics: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  const project = writeGeneratedProject(name, result.artifacts);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt", "--all", "--check"]);
  runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(project, ["build", "--all-targets", "--locked", "--offline"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["test", "--locked", "--offline"]);
  assert.equal(runCargo(project, ["run", "--locked", "--offline"]).status, 0,
    `${surface}: all branch, evaluation-count and overwrite controls execute successfully`);
}

for (const surface of ["native", "js"]) {
  test(`${surface}: condition stores retain branch reads, overwrite versions and native effect order`, { timeout: 300_000 }, () => {
    validateControl(surface, source, `condition_liveness_${surface}`);
  });
}

test("js: a for-in break preserves its selected key after the iteration", { timeout: 300_000 }, () => {
  validateControl("js", `
import type { int32 } from "@tsonic/core/types.js";
export function main(): void {
  const values: { first: int32; second: int32 } = { first: 1, second: 2 };
  let selected = "";
  for (const key in values) { if (key === "first") { selected = key; break; } }
  if (selected !== "first") throw new Error("for-in break liveness");
}
main();
`, "for_in_break_liveness");
});
