import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/marker-layout-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import type { RustProgramRecords } from "${join(root, "dist/target-model/records/program.js")}";
import type { RustAnalysisRecords } from "${join(root, "dist/target-model/records/analysis.js")}";
import type { Node } from "@tsonic/tsts";
declare const node: Node;
const builder = createRustProgramRecordBuilder();
declare const records: RustProgramRecords;
declare const analysis: RustAnalysisRecords;
`;

function check(directory, text) {
  writeFileSync(join(directory, "case.ts"), prelude + text);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "strict proof finishes without signal or truncated diagnostics");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("marker/layout producers accept only exact domain inputs and preserve their public read-only family types", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.compileTimeSources.erase(node);
builder.selfModes.method(node, "ref");
builder.selfModes.method(node, "mut-ref");
builder.memoryLayoutObservations.observe(node, 0n);
builder.memoryLayoutObservations.observe(node, 65536n);
const erased: true | undefined = records.compileTimeSource.get(node);
const mode: "ref" | "mut-ref" | undefined = records.selfMode.get(node)?.mode;
const value: bigint | undefined = analysis.memoryLayoutObservation.get(node)?.value;
const sealed: RustProgramRecords = builder;
`);
  assert.equal(positive.status, 0, positive.diagnostics.slice(0, 2048));
  const invalid = [
    ...["compileTimeSource", "selfMode", "memoryLayoutObservation"].flatMap(family => [
      [`${family} builder writer`, `builder.${family}.set(node, undefined);`, /Property 'set' does not exist/u],
      [`${family} final writer`, `${family === "memoryLayoutObservation" ? "analysis" : "records"}.${family}.set(node, undefined);`, /Property 'set' does not exist/u],
    ]),
    ...["compileTimeSources", "selfModes", "memoryLayoutObservations"].map(producer =>
      [`${producer} leaked port`, `records.${producer};`, /does not exist/u]),
    ["compile-time retired key", `import { rustCompileTimeSourceKey } from "${join(root, "dist/analysis/program/records/keys/source-declarations.js")}";`, /Cannot find module/u],
    ["receiver retired key", `import { rustSelfModeFactKey } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";`, /Cannot find module.*\/keys\/value-projections\.js/u],
    ["layout retired key", `import { rustMemoryLayoutObservationKey } from "${join(root, "dist/analysis/program/records/keys/memory-layout.js")}";`, /Cannot find module/u],
    ["erase missing subject", "builder.compileTimeSources.erase();", /Expected 1 arguments/u],
    ["erase foreign subject", "builder.compileTimeSources.erase(1);", /not assignable/u],
    ["erase old value", "builder.compileTimeSources.erase(node, true);", /Expected 1 arguments/u],
    ["erase false flag", "builder.compileTimeSources.erase(node, false);", /Expected 1 arguments/u],
    ["mode missing selection", "builder.selfModes.method(node);", /Expected 2 arguments/u],
    ["mode foreign subject", "builder.selfModes.method(1, 'ref');", /not assignable/u],
    ["mode DTO", "builder.selfModes.method(node, { mode: 'ref' });", /not assignable/u],
    ["owned receiver", "builder.selfModes.method(node, 'value');", /not assignable/u],
    ["guessed mutable receiver", "builder.selfModes.method(node, 'mut');", /not assignable/u],
    ["absent receiver", "builder.selfModes.method(node, undefined);", /not assignable/u],
    ["layout missing selection", "builder.memoryLayoutObservations.observe(node);", /Expected 2 arguments/u],
    ["layout foreign subject", "builder.memoryLayoutObservations.observe(1, 4);", /not assignable/u],
    ["layout DTO", "builder.memoryLayoutObservations.observe(node, { value: 4 });", /not assignable/u],
    ["layout text", "builder.memoryLayoutObservations.observe(node, '4');", /not assignable/u],
    ["layout absent selection", "builder.memoryLayoutObservations.observe(node, undefined);", /not assignable/u],
    ["layout evidence overload", "builder.memoryLayoutObservations.observe(node, 4, []);", /Expected 2 arguments/u],
    ["sealed erase port", "builder.seal([]).compileTimeSources.erase(node);", /does not exist/u],
    ["sealed receiver port", "builder.seal([]).selfModes.method(node, 'ref');", /does not exist/u],
    ["sealed layout port", "builder.seal([]).memoryLayoutObservations.observe(node, 4);", /does not exist/u],
    ...["memoryBindingPlan", "rawLocationPlan", "rawAddressPlan", "memoryLayoutObservation", "typedLocationPlan"].map(family =>
      [`${family} removed backend reader`, `records.${family}.get(node);`, /does not exist/u]),
  ];
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.equal(result.status !== 0, true, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 36);
});
