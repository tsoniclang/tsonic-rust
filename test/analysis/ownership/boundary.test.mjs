import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("the ownership handoff rejects executable queries and writable catalogs at compile time", () => {
  const temporary = join(root, ".temp");
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "ownership-boundary-"));
  const config = join(directory, "tsconfig.json");
  const source = join(directory, "boundary.ts");
  writeFileSync(config, JSON.stringify({
    extends: resolve(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, incremental: false, composite: false, declaration: false,
      declarationMap: false, rootDir: directory },
    files: [source], include: [], exclude: [],
  }));
  const header = [
    'import type { Node } from "@tsonic/tsts";',
    'import type { RustTargetProgram } from "../../dist/target-model/records/target-program.js";',
    'import * as locations from "../../dist/backend/planner/expressions/typed-locations.js";',
    "declare const program: RustTargetProgram;",
    "declare const node: Node;",
  ].join("\n");
  const compile = text => {
    writeFileSync(source, text);
    return spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"), ["--project", config, "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024,
    });
  };
  const valid = compile(header + [
    "export const read = program.records.readOwnership.get(node);",
    "export const capture = program.records.captureOwnership.get(node);",
    "export const render = locations.planRustValueRead;",
  ].join("\n"));
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  const invalid = compile(header + [
    "void program.valueLifetimes;",
    "void program.borrowStability;",
    "void locations.rustReadRequiresClone;",
    "void locations.planRustNonConsumingValue;",
    "void locations.rustExpressionReadsStorage;",
    "void program.records.readOwnership.set;",
    "void program.records.captureOwnership.set;",
    "void program.ownership;",
    "void program.records.readOwnership.get(node)?.borrowedAcross.add;",
  ].join("\n"));
  const output = invalid.stdout + invalid.stderr;
  assert.equal(invalid.status, 1, output);
  assert.equal((output.match(/error TS2339:/gu) ?? []).length, 9, output);
  for (const member of ["valueLifetimes", "borrowStability", "rustReadRequiresClone", "planRustNonConsumingValue",
    "rustExpressionReadsStorage", "set", "add", "ownership"]) assert.equal(output.includes("Property '" + member + "' does not exist"), true, member);
});
