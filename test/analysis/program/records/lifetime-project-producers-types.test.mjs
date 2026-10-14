import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/lifetime-project-producers-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
import type { RustProjectUpcastFact } from "${join(root, "dist/target-model/records/value-projections.js")}";
import type { RustProjectProjectionSelection } from "${join(root, "dist/target-model/types/project-projections.js")}";
const builder = createRustProgramRecordBuilder();
declare const subject: ExtensionFactSubject;
declare const carrier: TargetTypeRef;
declare const projection: RustProjectProjectionSelection;
declare const variants: RustProjectUpcastFact["sourceVariants"];
`;

function check(directory, text) {
  writeFileSync(join(directory, "case.ts"), prelude + text);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "bounded strict compiler proof completes normally");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("three physical projection APIs reject superseded writers, keys and malformed checked inputs", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.callScopedLifetimes.reconcile(subject, carrier, carrier);
builder.projectUpcasts.project(subject, carrier, carrier);
builder.projectUpcasts.project(subject, carrier, carrier, variants);
builder.projectDowncasts.project(subject, carrier, carrier, carrier, projection);
builder.callScopedLifetimeReconciliation.get(subject);
builder.projectUpcast.get(subject);
builder.projectDowncast.get(subject);
import { rustFlowReadProjectionFactKey, rustOptionProjectionFactKey, rustContextualValueConversionFactKey,
  rustSourceBindingFactKey, rustMutatedBindingFactKey,
  rustMutatedReferentFactKey, rustSelfModeFactKey } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";
`);
  assert.equal(positive.status, 0, positive.diagnostics);
  const invalid = [
    ...["callScopedLifetimeReconciliation", "projectUpcast", "projectDowncast"].map(family =>
      [family, `builder.${family}.set(subject, undefined);`, /Property 'set' does not exist/u]),
    ...["rustCallScopedLifetimeReconciliationFactKey", "rustProjectUpcastFactKey", "rustProjectDowncastFactKey"].map(key =>
      [key, `import { ${key} } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";`, /has no exported member|no exported member named/u]),
    ["lifetime foreign subject", "builder.callScopedLifetimes.reconcile(1, carrier, carrier);", /not assignable/u],
    ["lifetime missing selected carrier", "builder.callScopedLifetimes.reconcile(subject, carrier);", /Expected 3 arguments/u],
    ["lifetime malformed source", "builder.callScopedLifetimes.reconcile(subject, { kind: 'invalid' }, carrier);", /not assignable/u],
    ["lifetime malformed selected", "builder.callScopedLifetimes.reconcile(subject, carrier, { kind: 'invalid' });", /not assignable/u],
    ["lifetime malformed lifetime", "builder.callScopedLifetimes.reconcile(subject, carrier, { kind: 'reference', mutable: false, referent: carrier, lifetime: { kind: 'guessed' } });", /not assignable/u],
    ["upcast foreign subject", "builder.projectUpcasts.project(1, carrier, carrier);", /not assignable/u],
    ["upcast missing target", "builder.projectUpcasts.project(subject, carrier);", /Expected 3-4 arguments/u],
    ["upcast malformed source", "builder.projectUpcasts.project(subject, { kind: 'invalid' }, carrier);", /not assignable/u],
    ["upcast malformed target", "builder.projectUpcasts.project(subject, carrier, { kind: 'invalid' });", /not assignable/u],
    ["upcast missing variant carrier", "builder.projectUpcasts.project(subject, carrier, carrier, [{ name: 'Payload' }]);", /Property 'carrier' is missing/u],
    ["upcast malformed variant name", "builder.projectUpcasts.project(subject, carrier, carrier, [{ name: 1, carrier }]);", /not assignable/u],
    ["upcast malformed variant carrier", "builder.projectUpcasts.project(subject, carrier, carrier, [{ name: 'Payload', carrier: { kind: 'invalid' } }]);", /not assignable/u],
    ["downcast foreign subject", "builder.projectDowncasts.project(1, carrier, carrier, carrier, projection);", /not assignable/u],
    ["downcast missing route", "builder.projectDowncasts.project(subject, carrier, carrier, carrier);", /Expected 5 arguments/u],
    ["downcast malformed source", "builder.projectDowncasts.project(subject, { kind: 'invalid' }, carrier, carrier, projection);", /not assignable/u],
    ["downcast malformed dispatch", "builder.projectDowncasts.project(subject, carrier, { kind: 'invalid' }, carrier, projection);", /not assignable/u],
    ["downcast malformed target", "builder.projectDowncasts.project(subject, carrier, carrier, { kind: 'invalid' }, projection);", /not assignable/u],
    ["downcast malformed kind", "builder.projectDowncasts.project(subject, carrier, carrier, carrier, { kind: 'guessed' });", /not assignable/u],
    ["downcast missing checked slot", "builder.projectDowncasts.project(subject, carrier, carrier, carrier, { kind: 'checked' });", /Property 'slot' is missing/u],
    ["downcast malformed structural slot", "builder.projectDowncasts.project(subject, carrier, carrier, carrier, { kind: 'structural', slot: 1 });", /not assignable/u],
    ["sealed reader writer", "builder.seal().projectUpcast.set(subject, undefined);", /Property 'set' does not exist/u],
    ["sealed producer handle", "builder.seal().projectDowncasts;", /does not exist/u],
  ];
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 28);
});
