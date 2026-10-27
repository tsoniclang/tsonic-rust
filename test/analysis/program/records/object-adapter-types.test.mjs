import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const directory = resolve(root, ".temp/object-adapter-type-proof");
const compiler = resolve(root, "../tsonic/node_modules/.bin/tsgo");

function compile(name, text) {
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${name}.ts`);
  writeFileSync(path, text);
  const project = resolve(directory, `${name}.json`);
  writeFileSync(project, JSON.stringify({
    extends: resolve(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { rootDir: directory, noEmit: true, noUnusedLocals: false, noUnusedParameters: false },
    include: [path],
  }));
  return spawnSync(compiler, ["--project", project, "--pretty", "false"], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 262_144,
  });
}

const imports = `
  import type { Node, SourceFile } from "@tsonic/tsts";
  import type { RustProgramRecordBuilder } from "../../dist/analysis/program/records/model.js";
  import type { RustFactWalk } from "../../dist/analysis/program/walk.js";
  import type { RustProgramRecords } from "../../dist/target-model/records/program.js";
  import type { RustObjectLiteralMethodAdapterInput } from "../../dist/analysis/objects/method-adapters.js";
  import type { RustObjectReferenceView } from "../../dist/target-model/records/object-reference-views.js";
  import type { TargetTypeRef } from "../../dist/target-model/types/model.js";
  declare const builder: RustProgramRecordBuilder;
  declare const records: RustProgramRecords;
  declare const walk: RustFactWalk;
  declare const subject: Node;
  declare const files: readonly SourceFile[];
  declare const carrier: TargetTypeRef;
  declare const input: RustObjectLiteralMethodAdapterInput;
`;

test("typed object and adapter producers accept only their actual checked construction inputs", () => {
  const result = compile("accepted", `${imports}
    const copied: ReadonlySet<string> = builder.receiverIndependentMethods.finalize(walk, files, name => name);
    const classValue: TargetTypeRef | undefined = builder.classValues.resolve(walk, subject, carrier);
    builder.objectLiteralMethodAdapters.finalize({ ...input, requiredRecords: [], expressions: new Set([subject]) });
    builder.projectCallableAdapterPlans.finalize(walk);
    const view: RustObjectReferenceView | undefined = builder.objectReferenceViews.select(walk, subject, carrier, carrier);
    const readers: RustProgramRecords = builder;
    const selected: TargetTypeRef | undefined = readers.classValue.get(subject)?.carrier;
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("superseded generic writers, leaked producers and malformed construction inputs are rejected statically", () => {
  const families = ["receiverIndependentMethod", "classValue", "objectLiteralMethodAdapter", "projectCallableAdapters", "objectReferenceView"];
  const producers = ["receiverIndependentMethods", "classValues", "objectLiteralMethodAdapters", "projectCallableAdapterPlans", "objectReferenceViews"];
  const result = compile("rejected", `${imports}
    ${families.map(family => `builder.${family}.set(subject, undefined);`).join("\n")}
    ${families.map(family => `records.${family}.set(subject, undefined);`).join("\n")}
    ${producers.map(producer => `records.${producer};`).join("\n")}
    builder.receiverIndependentMethods.finalize(walk, [carrier], name => name);
    builder.classValues.resolve(walk, carrier, carrier);
    builder.objectLiteralMethodAdapters.finalize({ ...input, requiredRecords: [], expressions: new Set([carrier]) });
    builder.objectLiteralMethodAdapters.finalize({ ...input, requiredRecords: [], expressions: [subject] });
    builder.projectCallableAdapterPlans.finalize(carrier);
    builder.objectReferenceViews.select(walk, subject, subject, carrier);
    const oldBoolean: boolean = builder.objectReferenceViews.select(walk, subject, carrier, carrier);
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status === 0, false, "all removed or malformed forms must fail source checking");
  const codes = [...result.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1]));
  assert.deepEqual(codes, [...Array(10).fill(2339), ...Array(5).fill(2551), 2322, 2345, 2322, 2739, 2345, 2345, 2322]);
});

test("removed private key modules and owned key exports have no surviving alternate import path", () => {
  const result = compile("removed-keys", `
    import { rustClassValueFactKey } from "../../dist/analysis/program/records/keys/class-values.js";
    import { rustObjectReferenceViewKey } from "../../dist/analysis/program/records/keys/object-reference-views.js";
    import { rustProjectCallableAdaptersKey } from "../../dist/analysis/program/records/keys/project-callable-adapters.js";
    import { rustReceiverIndependentMethodFactKey } from "../../dist/analysis/program/records/keys/operation-selections.js";
    import { rustObjectLiteralMethodAdapterFactKey } from "../../dist/analysis/program/records/keys/object-methods.js";
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status === 0, false, "every superseded key form must be gone");
  assert.deepEqual([...result.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1])), [2307, 2307, 2307, 2307, 2307]);
});
