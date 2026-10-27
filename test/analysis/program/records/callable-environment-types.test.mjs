import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/callable-environment-types");
const prelude = `
  import type { Node } from "@tsonic/tsts";
  import type { RustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/model.js")}";
  import type { RustProgramRecords } from "${join(root, "dist/target-model/records/program.js")}";
  import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
  import type { RustRetainedEnvironment } from "${join(root, "dist/target-model/records/callables/retained-environments.js")}";
  declare const builder: RustProgramRecordBuilder;
  declare const records: RustProgramRecords;
  declare const reference: Node;
  declare const declaration: Node;
  declare const carrier: TargetTypeRef;
  declare const parameters: readonly TargetTypeRef[];
  declare const lifetime: RustRetainedEnvironment["lifetime"];
`;

test("callable/environment producers require semantic inputs and reject every retired construction route", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    files: [join(directory, "case.ts")], include: [], exclude: [],
  }));
  const check = text => {
    writeFileSync(join(directory, "case.ts"), prelude + text);
    const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"), ["-p", join(directory, "tsconfig.json"), "--pretty", "false"],
      { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 131_072 });
    assert.equal(result.error === undefined && result.signal === null, true, "bounded strict compiler completes");
    return { status: result.status, diagnostics: result.stdout + result.stderr };
  };
  const positive = check(`
    builder.sourceCallableValues.function(reference, declaration, "input.ts", "keepMyCase", carrier, parameters, carrier);
    builder.directCallableReferences.function(reference, declaration, "input.ts", "keepMyCase", carrier, [], carrier);
    builder.retainedEnvironments.retain(declaration, lifetime, [{ kind: 'parameter', declaration: reference }]);
    const callable: Node | undefined = records.sourceCallableValue.get(reference)?.sourceDeclaration;
    const direct: TargetTypeRef | undefined = records.directCallableReference.get(reference)?.resultCarrier;
    const retained: RustRetainedEnvironment["lifetime"] | undefined = records.retainedEnvironment.get(declaration)?.lifetime;
  `);
  assert.equal(positive.status, 0, positive.diagnostics.slice(0, 2048));
  const invalid = [];
  for (const family of ["sourceCallableValue", "directCallableReference", "retainedEnvironment"]) {
    invalid.push([`${family} builder setter`, `builder.${family}.set(reference, {});`, /Property 'set' does not exist/u]);
    invalid.push([`${family} sealed setter`, `records.${family}.set(reference, {});`, /Property 'set' does not exist/u]);
  }
  for (const producer of ["sourceCallableValues", "directCallableReferences", "retainedEnvironments"]) {
    invalid.push([`${producer} sealed leak`, `records.${producer};`, /does not exist/u]);
  }
  for (const producer of ["sourceCallableValues", "directCallableReferences"]) {
    invalid.push([`${producer} missing signature`, `builder.${producer}.function(reference, declaration, 'input.ts', 'step', carrier);`, /Expected 7 arguments/u]);
    invalid.push([`${producer} DTO setter`, `builder.${producer}.function(reference, { form: 'function', sourceDeclaration: declaration, carrier });`, /Expected 7 arguments/u]);
    invalid.push([`${producer} invalid subject`, `builder.${producer}.function(carrier, declaration, 'input.ts', 'step', carrier, parameters, carrier);`, /not assignable/u]);
    invalid.push([`${producer} invalid declaration`, `builder.${producer}.function(reference, carrier, 'input.ts', 'step', carrier, parameters, carrier);`, /not assignable/u]);
    invalid.push([`${producer} invalid file`, `builder.${producer}.function(reference, declaration, reference, 'step', carrier, parameters, carrier);`, /not assignable/u]);
    invalid.push([`${producer} invalid carrier`, `builder.${producer}.function(reference, declaration, 'input.ts', 'step', declaration, parameters, carrier);`, /not assignable/u]);
    invalid.push([`${producer} invalid parameters`, `builder.${producer}.function(reference, declaration, 'input.ts', 'step', carrier, [reference], carrier);`, /not assignable/u]);
    invalid.push([`${producer} invalid result`, `builder.${producer}.function(reference, declaration, 'input.ts', 'step', carrier, parameters, reference);`, /not assignable/u]);
  }
  invalid.push(["environment DTO setter", "builder.retainedEnvironments.retain(declaration, { lifetime, inputs: [] });", /Expected 3 arguments/u]);
  invalid.push(["environment declaration", "builder.retainedEnvironments.retain(carrier, lifetime, []);", /not assignable/u]);
  invalid.push(["environment static lifetime", "builder.retainedEnvironments.retain(declaration, { kind: 'static' }, []);", /not assignable/u]);
  invalid.push(["environment placeholder lifetime", "builder.retainedEnvironments.retain(declaration, { kind: 'placeholder' }, []);", /not assignable/u]);
  invalid.push(["environment parameter kind", "builder.retainedEnvironments.retain(declaration, lifetime, [{ kind: 'parameter', declaration: carrier }]);", /not assignable/u]);
  invalid.push(["source callable old key", `import { rustSourceCallableValueFactKey } from "${join(root, "dist/analysis/program/records/keys/operation-selections.js")}";`, /Cannot find module.*\/keys\/operation-selections\.js/u]);
  invalid.push(["direct callable old key", `import { rustDirectCallableReferenceFactKey } from "${join(root, "dist/analysis/program/records/keys/operation-selections.js")}";`, /Cannot find module.*\/keys\/operation-selections\.js/u]);
  invalid.push(["retained environment old path/key", `import { rustRetainedEnvironmentFactKey } from "${join(root, "dist/analysis/program/records/keys/retained-environments.js")}";`, /Cannot find module/u]);
  for (const [label, text, diagnostic] of invalid) {
    const result = check(text);
    assert.equal(result.status === 0, false, label);
    assert.match(result.diagnostics, diagnostic, label);
  }
  assert.equal(invalid.length, 33);
});
