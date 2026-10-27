import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/parameter-generator-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import type { Node } from "@tsonic/tsts";
import type { RustGeneratorProtocol } from "${join(root, "dist/target-model/types/index.js")}";
import type { RustGeneratorFact, RustSourceParameterAbiFact, RustSuspendedCallableStorage, RustSuspendedOwnedReceiver } from "${join(root, "dist/target-model/records/callables/callables-and-resources.js")}";
const builder = createRustProgramRecordBuilder();
declare const subject: Node;
declare const parameter: Node;
declare const protocol: RustGeneratorProtocol;
declare const storage: RustSuspendedCallableStorage;
declare const receiver: RustSuspendedOwnedReceiver;
declare const selectedAbi: RustSourceParameterAbiFact;
declare const arbitraryFact: RustSourceParameterAbiFact;
const retention: Pick<RustGeneratorFact, "capturedParameters" | "storage"> = {
  capturedParameters: [parameter], storage };
`;

function check(directory, body) {
  writeFileSync(join(directory, "case.ts"), prelude + body);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "the guarded strict type proof finishes normally");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("parameter, generator and binding producer types expose exact domain inputs and reject every retired form", () => {
  assert.equal(existsSync(join(root, "src/analysis/declarations/types-and-bindings.ts")), false,
    "the retired parameter ABI forwarding module is absent from the current source architecture");
  assert.equal(existsSync(join(root, "dist/analysis/declarations/types-and-bindings.js")), false,
    "a stale built forwarding module cannot keep the retired API callable");
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.generators.suspend(subject, protocol, retention);
builder.generators.suspend(subject, protocol, { ...retention, ownedReceiver: receiver });
builder.sourceParameterAbis.parameter(parameter, selectedAbi);
builder.sourceParameterAbis.use(subject, parameter);
const lexical = builder.sourceBindings.lexical(subject, parameter, "AuthoredName");
const module = builder.sourceBindings.module(subject, parameter, "AuthoredName", "/src/value.ts");
const lexicalScope: "lexical" = lexical.scope;
const moduleScope: "module" = module.scope;
builder.generator.get(subject);
builder.sourceParameterAbi.get(subject);
builder.sourceBinding.get(subject);
`);
  assert.equal(positive.status, 0, positive.diagnostics);
  const invalid = [
    ...["generator", "sourceParameterAbi", "sourceBinding"].map(family =>
      [family + " generic writer", `builder.${family}.set(subject, undefined);`, /Property 'set' does not exist/u]),
    ["generator key", `import { rustGeneratorFactKey } from "${join(root, "dist/analysis/program/records/keys/callables-and-resources.js")}";`, /Cannot find module/u],
    ["parameter ABI key", `import { rustSourceParameterAbiFactKey } from "${join(root, "dist/analysis/program/records/keys/callables-and-resources.js")}";`, /Cannot find module/u],
    ["source binding key", `import { rustSourceBindingFactKey } from "${join(root, "dist/analysis/program/records/keys/value-projections.js")}";`, /Cannot find module.*\/keys\/value-projections\.js/u],
    ["parameter ABI forwarder", `import { setParameterAbiFact } from "${join(root, "dist/analysis/declarations/types-and-bindings.js")}";`, /Cannot find module.*\/declarations\/types-and-bindings\.js/u],
    ["generator foreign declaration", "builder.generators.suspend({}, protocol, retention);", /missing.*properties.*Node/u],
    ["generator missing protocol", "builder.generators.suspend(subject, {}, retention);", /missing.*properties.*RustGeneratorProtocol/u],
    ["generator unknown kind", "builder.generators.suspend(subject, { ...protocol, kind: 'iterator' }, retention);", /not assignable/u],
    ["generator missing next type", "builder.generators.suspend(subject, { kind: 'sync', yieldType: protocol.yieldType, returnType: protocol.returnType }, retention);", /nextType/u],
    ["generator foreign yield carrier", "builder.generators.suspend(subject, { ...protocol, yieldType: { kind: 'invalid' } }, retention);", /not assignable/u],
    ["generator caller-defined result carrier", "builder.generators.suspend(subject, { ...protocol, resultCarrier: protocol.returnType }, retention);", /resultCarrier.*does not exist/u],
    ["generator missing captured parameters", "builder.generators.suspend(subject, protocol, { storage });", /capturedParameters.*missing/u],
    ["generator retired excluded reentry", "builder.generators.suspend(subject, protocol, { ...retention, reentry: 'excluded' });", /reentry.*does not exist/u],
    ["generator retired possible reentry", "builder.generators.suspend(subject, protocol, { ...retention, reentry: 'possible' });", /reentry.*does not exist/u],
    ["generator foreign capture", "builder.generators.suspend(subject, protocol, { ...retention, capturedParameters: [{}] });", /missing.*properties.*Node/u],
    ["generator unproved lifetime", "builder.generators.suspend(subject, protocol, { ...retention, storage: { kind: 'lifetime' } });", /lifetime.*missing/u],
    ["generator foreign owned receiver", "builder.generators.suspend(subject, protocol, { ...retention, ownedReceiver: {} });", /missing.*properties.*RustSuspendedOwnedReceiver/u],
    ["parameter foreign subject", "builder.sourceParameterAbis.parameter({}, selectedAbi);", /missing.*properties.*Node/u],
    ["parameter missing selection", "builder.sourceParameterAbis.parameter(parameter, {});", /missing.*properties.*RustSourceParameterAbi/u],
    ["parameter unknown form", "builder.sourceParameterAbis.parameter(parameter, { ...selectedAbi, form: 'loose' });", /not assignable/u],
    ["parameter unknown mode", "builder.sourceParameterAbis.parameter(parameter, { ...selectedAbi, mode: 'shared' });", /not assignable/u],
    ["parameter foreign physical carrier", "builder.sourceParameterAbis.parameter(parameter, { ...selectedAbi, parameterCarrier: { kind: 'invalid' } });", /not assignable/u],
    ["parameter static input lifetime", "builder.sourceParameterAbis.parameter(parameter, { ...selectedAbi, inputLifetime: { kind: 'static' } });", /not assignable/u],
    ["parameter foreign entry conversion", "builder.sourceParameterAbis.parameter(parameter, { ...selectedAbi, entryConversion: { kind: 'invalid' } });", /'kind' does not exist in type 'RustParameterEntryConversion'/u],
    ["use foreign expression", "builder.sourceParameterAbis.use({}, parameter);", /missing.*properties.*Node/u],
    ["use arbitrary fact", "builder.sourceParameterAbis.use(subject, arbitraryFact);", /RustSourceParameterAbiFact.*missing.*properties.*Node/u],
    ["use missing source", "builder.sourceParameterAbis.use(subject);", /Expected 2 arguments/u],
    ["lexical foreign reference", "builder.sourceBindings.lexical({}, parameter, 'value');", /missing.*properties.*Node/u],
    ["lexical foreign declaration", "builder.sourceBindings.lexical(subject, {}, 'value');", /missing.*properties.*Node/u],
    ["lexical numeric source name", "builder.sourceBindings.lexical(subject, parameter, 7);", /not assignable/u],
    ["module missing file", "builder.sourceBindings.module(subject, parameter, 'value');", /Expected 4 arguments/u],
    ["module numeric file", "builder.sourceBindings.module(subject, parameter, 'value', 7);", /not assignable/u],
    ["module foreign declaration", "builder.sourceBindings.module(subject, {}, 'value', '/src/value.ts');", /missing.*properties.*Node/u],
    ["module numeric source name", "builder.sourceBindings.module(subject, parameter, 7, '/src/value.ts');", /not assignable/u],
    ["lexical module field", "builder.sourceBindings.lexical(subject, parameter, 'value').fileName;", /Property 'fileName' does not exist/u],
  ];
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 37, "all 37 exact retired producer forms retain their individual type-level refusals");
});
