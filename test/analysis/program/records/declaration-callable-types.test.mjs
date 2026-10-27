import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const directory = resolve(root, ".temp/declaration-callable-type-proof");
const compiler = resolve(root, "../tsonic/node_modules/.bin/tsgo");

function compile(name, text) {
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${name}.ts`);
  writeFileSync(file, text);
  const project = resolve(directory, `${name}.json`);
  writeFileSync(project, JSON.stringify({ extends: resolve(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { rootDir: directory, noEmit: true, noUnusedLocals: false, noUnusedParameters: false }, include: [file] }));
  return spawnSync(compiler, ["--project", project, "--pretty", "false"], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 262_144,
  });
}

const declarations = `
  import type { Node, SourceFile } from "@tsonic/tsts";
  import type { RustProgramRecordBuilder } from "../../dist/analysis/program/records/model.js";
  import type { RustProgramRecords } from "../../dist/target-model/records/program.js";
  import type { RustFactWalk } from "../../dist/analysis/program/walk.js";
  import type { TargetTypeRef } from "../../dist/target-model/types/model.js";
  declare const builder: RustProgramRecordBuilder;
  declare const records: RustProgramRecords;
  declare const walk: RustFactWalk;
  declare const subject: Node;
  declare const files: readonly SourceFile[];
  declare const carrier: TargetTypeRef;
`;
const families = ["typeOnlyDeclaration", "moduleBinding", "moduleCallableStorage", "sourceCallableReturn", "capturedFieldStorage"];
const producers = ["typeOnlyDeclarations", "moduleBindings", "moduleCallableStoragePlans", "sourceCallableReturns", "capturedFieldStoragePlans"];

test("five declaration and callable producer APIs accept their precise source and native inputs", () => {
  const result = compile("accepted", `${declarations}
    builder.typeOnlyDeclarations.finalize(walk, files);
    builder.typeOnlyDeclarations.representationAliases(walk, files);
    builder.moduleBindings.value(walk, subject, "let", carrier);
    builder.moduleBindings.function(subject, "step", { name: "step", carrier, parameterCarriers: [carrier], resultCarrier: carrier });
    builder.moduleBindings.callable(subject, subject, "step", undefined);
    builder.moduleBindings.defaultExport(subject, carrier);
    builder.moduleCallableStoragePlans.finalize(walk);
    const resolved: boolean = builder.sourceCallableReturns.resolve(walk, subject, carrier);
    builder.sourceCallableReturns.setter(subject);
    builder.capturedFieldStoragePlans.resolve(walk, subject, carrier);
    const sealed: RustProgramRecords = builder;
    const exact: TargetTypeRef | undefined = sealed.sourceCallableReturn.get(subject)?.returnCarrier;
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("removed general writes, leaked producers and malformed declaration inputs are statically rejected", () => {
  const result = compile("rejected", `${declarations}
    ${families.map(family => `builder.${family}.set(subject, undefined);`).join("\n")}
    ${families.map(family => `records.${family}.set(subject, undefined);`).join("\n")}
    ${producers.map(producer => `records.${producer};`).join("\n")}
    builder.typeOnlyDeclarations.finalize(walk, [carrier]);
    builder.moduleBindings.value(walk, subject, "function", carrier);
    builder.moduleBindings.function(subject, "step", { name: "step", carrier, resultCarrier: carrier });
    builder.moduleBindings.callable(subject, carrier, "step", undefined);
    builder.moduleBindings.defaultExport(subject, subject);
    builder.moduleCallableStoragePlans.finalize(carrier);
    builder.sourceCallableReturns.resolve(walk, subject, subject);
    builder.capturedFieldStoragePlans.resolve(walk, carrier, carrier);
    builder.sourceCallableReturns.inferred(walk, subject, carrier);
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status === 0, false, "every removed or malformed form must fail source checking");
  const codes = [...result.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1]));
  assert.deepEqual(codes, [...Array(10).fill(2339), ...Array(5).fill(2551), 2322, 2345, 2741, 2345, 2345, 2345, 2345, 2345, 2339]);
});

test("all five old keys are deleted rather than left as an alternate registration vocabulary", () => {
  const result = compile("removed-keys", `
    import { rustTypeOnlyDeclarationFactKey } from "../../dist/analysis/program/records/keys/type-only.js";
    import { rustModuleCallableStorageFactKey } from "../../dist/analysis/program/records/keys/module-values.js";
    import { rustCapturedFieldStorageFactKey } from "../../dist/analysis/program/records/keys/receiver-captures.js";
    import { rustSourceCallableReturnFactKey } from "../../dist/analysis/program/records/keys/source-declarations.js";
    import { rustModuleBindingFactKey } from "../../dist/analysis/program/records/keys/operation-selections.js";
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status === 0, false, "no removed key has a surviving import path");
  assert.deepEqual([...result.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1])), [2307, 2307, 2307, 2307, 2307]);
});
