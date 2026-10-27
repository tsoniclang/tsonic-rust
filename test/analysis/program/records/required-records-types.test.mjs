import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/required-records-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import { requireRustRecord, type RustRequiredRecord } from "${join(root, "dist/analysis/program/records/objects/required-records.js")}";
import { recordRustConversionSelection } from "${join(root, "dist/analysis/program/records/types/value-carrier-admission.js")}";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
declare const subject: Node;
declare const carrier: TargetTypeRef;
const builder = createRustProgramRecordBuilder();
const required: RustRequiredRecord[] = [];
`;

function check(directory, body) {
  writeFileSync(join(directory, "case.ts"), prelude + body);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "the guarded strict proof finishes without truncated diagnostics");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("the selected-record inventory is mandatory, source-typed and absent from the sealed program", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
requireRustRecord(required, "runtimeCarrier", subject, "checked expression", "source selection");
recordRustConversionSelection(builder, required, subject, carrier);
builder.seal(Object.freeze(required));
`);
  assert.equal(positive.status, 0, positive.diagnostics);
  for (const [name, body, expected] of [
    ["removed empty seal", "builder.seal();", /Expected 1 arguments/u],
    ["missing producer", 'builder.seal([{ subject, family: "runtimeCarrier", construct: "expression" }]);', /producer.*missing/u],
    ["foreign family", 'requireRustRecord(required, "foreign", subject, "expression", "owner");', /not assignable/u],
    ["foreign subject", 'requireRustRecord(required, "runtimeCarrier", {}, "expression", "owner");', /missing.*properties.*Node/u],
    ["malformed construct", 'builder.seal([{ subject, family: "runtimeCarrier", construct: 7, producer: "owner" }]);', /not assignable/u],
    ["untyped inventory", "builder.seal([subject]);", /missing.*properties.*RustRequiredRecord/u],
    ["removed conversion arity", "recordRustConversionSelection(builder, subject, carrier);", /Expected 4 arguments/u],
    ["no published inventory", "builder.seal([]).requiredRecords;", /does not exist/u],
    ["no published producer", "builder.seal([]).requireRustRecord;", /does not exist/u],
  ]) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, expected, name);
  }
});
