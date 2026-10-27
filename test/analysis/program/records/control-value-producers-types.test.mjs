import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/control-value-producers-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import { recordRustIndexedCallKeyArguments } from "${join(root, "dist/analysis/operations/indexed-call-keys.js")}";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
import type { RustSelectedTargetSignature } from "${join(root, "dist/target-model/records/operations/member-selections.js")}";
import type { RustBinaryOperatorSelection } from "${join(root, "dist/target-model/operations/binary.js")}";
import type { RustValueConversion } from "${join(root, "dist/target-model/operations/model.js")}";
import type { RustPropertyProjectionCase } from "${join(root, "dist/target-model/records/objects/property-projections.js")}";
const builder = createRustProgramRecordBuilder();
declare const subject: Node;
declare const carrier: TargetTypeRef;
declare const selected: RustSelectedTargetSignature;
declare const operation: RustBinaryOperatorSelection;
declare const conversion: RustValueConversion;
declare const cases: readonly RustPropertyProjectionCase[];
const keys = new Map<string, TargetTypeRef>();
`;

function check(directory, body) {
  writeFileSync(join(directory, "case.ts"), prelude + body);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "the guarded strict type proof must finish normally");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("strict producer APIs accept exact checked inputs and reject generic writers and malformed shapes", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.nativeGuardResults.resolve(subject, () => false);
builder.nativeUnreachableNodes.resolve(subject, () => true);
builder.genericNumerics.comparison(subject, carrier, carrier, operation);
builder.genericNumerics.comparison(subject, carrier, carrier, undefined);
builder.indexedFieldKeys.selected(subject, carrier, false);
recordRustIndexedCallKeyArguments(builder, [], selected, [subject], keys, () => false);
builder.propertyProjections.finalize(subject, conversion, cases);
builder.propertyProjections.finalize(subject, undefined, cases);
builder.nativeGuardResult.get(subject);
builder.nativeUnreachable.get(subject);
builder.genericNumericOperands.get(subject);
builder.indexedFieldKeyArgument.get(subject);
builder.propertyProjection.get(subject);
`);
  assert.equal(positive.status, 0, positive.diagnostics);
  const removedWriters = ["nativeGuardResult", "nativeUnreachable", "genericNumericOperands", "indexedFieldKeyArgument", "propertyProjection"];
  const removedKeys = ["native-control-flow", "generic-numeric", "indexed-field-keys", "property-projections"];
  const invalid = [
    ...removedWriters.map(family => [family, `builder.${family}.set(subject, undefined);`, /Property 'set' does not exist/u]),
    ...removedKeys.map(name => [name, `import "${join(root, `dist/analysis/program/records/keys/${name}.js`)}";`, /Cannot find module/u]),
    ["guard numeric result", "builder.nativeGuardResults.resolve(subject, () => 1);", /not assignable/u],
    ["unreachable unknown result", "builder.nativeUnreachableNodes.resolve(subject, () => undefined);", /not assignable/u],
    ["guard foreign subject", "builder.nativeGuardResults.resolve({}, () => true);", /missing.*properties.*Node/u],
    ["unreachable foreign subject", "builder.nativeUnreachableNodes.resolve({}, () => true);", /missing.*properties.*Node/u],
    ["numeric foreign subject", "builder.genericNumerics.comparison({}, carrier, carrier, operation);", /missing.*properties.*Node/u],
    ["numeric malformed carrier", "builder.genericNumerics.comparison(subject, { kind: 'invalid' }, carrier, operation);", /not assignable/u],
    ["numeric malformed selection", "builder.genericNumerics.comparison(subject, carrier, carrier, { kind: 'invalid' });", /not assignable/u],
    ["indexed missing signature", "recordRustIndexedCallKeyArguments(builder, [], { nativeParameterDeclarations: [] }, [subject], keys, () => false);", /Property 'member' is missing.*RustSelectedTargetSignature/u],
    ["indexed foreign source", "builder.indexedFieldKeys.selected({}, carrier, false);", /missing.*properties.*Node/u],
    ["indexed malformed keys", "recordRustIndexedCallKeyArguments(builder, [], selected, [subject], new Map([['Key', 1]]), () => false);", /not assignable/u],
    ["indexed malformed evaluation", "builder.indexedFieldKeys.selected(subject, carrier, 'yes');", /not assignable/u],
    ["removed indexed batch", "builder.indexedFieldKeys.bind([], selected, [subject], keys, () => false);", /does not exist/u],
    ["indexed query foreign source", "recordRustIndexedCallKeyArguments(builder, [], selected, [{}], keys, () => false);", /missing.*properties.*Node/u],
    ["projection foreign source", "builder.propertyProjections.finalize({}, conversion, cases);", /missing.*properties.*Node/u],
    ["projection invalid conversion", "builder.propertyProjections.finalize(subject, { kind: 'invalid' }, cases);", /not assignable/u],
    ["projection missing read evidence", "builder.propertyProjections.finalize(subject, conversion, [{}]);", /missing.*properties.*RustPropertyProjectionCase/u],
  ];
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 25);
});
