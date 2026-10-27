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
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
import type { RustProjectUpcastFact } from "${join(root, "dist/target-model/records/objects/value-projections.js")}";
import type { RustProjectProjectionSelection } from "${join(root, "dist/target-model/types/project-projections.js")}";
import type { RustFlowReadProjectionInput } from "${join(root, "dist/analysis/program/records/operations/flow-read-projection.js")}";
import type { RustContextualValueConversion } from "${join(root, "dist/target-model/conversions/contextual.js")}";
import type { RustProjectTypePolicy } from "${join(root, "dist/target-model/types/project-types.js")}";
import type { RustTypeDefinitions } from "${join(root, "dist/target-model/types/source-union-definitions.js")}";
const builder = createRustProgramRecordBuilder();
declare const subject: Node;
declare const carrier: TargetTypeRef;
declare const projection: RustProjectProjectionSelection;
declare const variants: RustProjectUpcastFact["sourceVariants"];
declare const flow: RustFlowReadProjectionInput;
declare const conversion: RustContextualValueConversion;
declare const projectTypes: RustProjectTypePolicy;
declare const definitions: RustTypeDefinitions;
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

test("physical projection and conversion APIs reject superseded writers, keys and malformed checked inputs", () => {
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
builder.conversions.converted(subject, carrier);
builder.conversions.converted(subject, undefined);
builder.optionProjections.none(subject, carrier, carrier);
builder.optionProjections.some(subject, carrier, carrier, carrier);
builder.flowReadProjections.project(subject, carrier, carrier, flow);
builder.flowReadProjections.resolve([], subject, carrier, carrier, projectTypes, definitions);
builder.flowReadProjections.validate(subject, carrier, projectTypes, definitions);
builder.contextualValueConversions.convert(subject, carrier, carrier, conversion);
const converted: TargetTypeRef | undefined = builder.conversion.get(subject)?.convertedType;
const selected: TargetTypeRef | undefined = builder.flowReadProjection.get(subject)?.selectedCarrier;
`);
  assert.equal(positive.status, 0, positive.diagnostics);
  const invalid = [
    ["flow query missing native definitions", "builder.flowReadProjections.resolve([], subject, carrier, carrier, projectTypes);", /Expected 6 arguments/u],
    ["flow validation foreign source", "builder.flowReadProjections.validate(subject, {}, projectTypes, definitions);", /not assignable/u],
    ["sealed flow query", "builder.seal([]).flowReadProjection.resolve(subject, carrier, carrier, projectTypes, definitions);", /Property 'resolve' does not exist/u],
    ...["callScopedLifetimeReconciliation", "projectUpcast", "projectDowncast"].map(family =>
      [family, `builder.${family}.set(subject, undefined);`, /Property 'set' does not exist/u]),
    ...["rustCallScopedLifetimeReconciliationFactKey", "rustProjectUpcastFactKey", "rustProjectDowncastFactKey"].map(key =>
      [key, `import { ${key} } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";`, /Cannot find module.*\/keys\/value-projections\.js/u]),
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
    ["sealed reader writer", "builder.seal([]).projectUpcast.set(subject, undefined);", /Property 'set' does not exist/u],
    ["sealed producer handle", "builder.seal([]).projectDowncasts;", /does not exist/u],
  ];
  invalid.push(
    ...["conversion", "optionProjection", "flowReadProjection", "contextualValueConversion"].flatMap(family => [
      [family + " retired writer", `builder.${family}.set(subject, undefined);`, /Property 'set' does not exist/u],
      [family + " sealed writer", `builder.seal([]).${family}.set(subject, undefined);`, /Property 'set' does not exist/u],
    ]),
    ...["conversions", "optionProjections", "flowReadProjections", "contextualValueConversions"].map(producer =>
      [producer + " leaked producer", `builder.seal([]).${producer};`, /does not exist/u]),
    ...["rustOptionProjectionFactKey", "rustFlowReadProjectionFactKey", "rustContextualValueConversionFactKey"].map(key =>
      [key, `import { ${key} } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";`, /Cannot find module.*\/keys\/value-projections\.js/u]),
    ["retired conversion key", `import { rustConversionKey } from "${join(root, "dist/analysis/program/records/keys/selections.js")}";`, /Cannot find module.*\/keys\/selections\.js/u],
    ["missing converted carrier", "builder.conversions.converted(subject);", /Expected 2 arguments/u],
    ["invalid converted carrier", "builder.conversions.converted(subject, { kind: 'guessed' });", /not assignable/u],
    ["old conversion evidence", "builder.conversions.converted(subject, carrier, []);", /Expected 2 arguments/u],
    ["missing absence result", "builder.optionProjections.none(subject, carrier);", /Expected 3 arguments/u],
    ["missing presence element", "builder.optionProjections.some(subject, carrier, carrier);", /Expected 4 arguments/u],
    ["missing flow payload", "builder.flowReadProjections.project(subject, carrier, carrier, { kind: 'union-map' });", /missing/u],
    ["unknown flow kind", "builder.flowReadProjections.project(subject, carrier, carrier, { kind: 'guessed' });", /not assignable/u],
    ["old flow evidence", "builder.flowReadProjections.project(subject, carrier, carrier, flow, []);", /Expected 4 arguments/u],
    ["unknown contextual conversion", "builder.contextualValueConversions.convert(subject, carrier, carrier, { kind: 'guessed' });", /not assignable/u],
    ["retired flow forwarder", `import { recordRustFlowReadProjection } from "${join(root, "dist/analysis/conversions/value-carrier-queries.js")}";`, /has no exported member|no exported member named/u],
    ["retired generic plan key", `import type { RustPlanKey } from "${join(root, "dist/analysis/program/records/key.js")}";`, /Cannot find module.*\/records\/key\.js/u],
    ["private writer is not a program model port", `import type { RustRecordWriter } from "${join(root, "dist/analysis/program/records/model.js")}";`, /has no exported member|no exported member named/u],
    ["removed generic reuse port", `import { createRustRecordFamily } from "${join(root, "dist/analysis/program/records/family.js")}";
      const family = createRustRecordFamily({ id: "typed", equals: (left: number, right: number) => left === right }, () => {});
      family.reuse({}, 1);`, /Property 'reuse' does not exist/u],
  );
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 60);
});
