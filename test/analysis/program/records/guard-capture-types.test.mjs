import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/guard-capture-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
import type { RustProviderOperationTemplate } from "${join(root, "dist/target-model/operations/model.js")}";
import type { RustOptionalChainContract } from "${join(root, "dist/analysis/program/records/operations/optional-chain.js")}";
import type { RustClosureCaptureFact } from "${join(root, "dist/target-model/records/operations/operation-selections.js")}";
declare const node: Node;
declare const carrier: TargetTypeRef;
declare const operation: RustProviderOperationTemplate;
declare const contract: RustOptionalChainContract;
declare const captures: RustClosureCaptureFact["captures"];
declare const receivers: RustClosureCaptureFact["receivers"];
declare const fields: RustClosureCaptureFact["receiverFields"];
declare const recursiveField: Exclude<RustClosureCaptureFact["recursiveField"], undefined>;
const builder = createRustProgramRecordBuilder();
`;

function check(directory, body) {
  writeFileSync(join(directory, "case.ts"), prelude + body);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "strict compiler proof completes without a signal or truncated diagnostics");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("guard/capture APIs reject every retired writer/key and malformed native or source contract", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.preparedOperations.prepare(node, operation, carrier);
builder.optionalChains.guard(node, node, "property", contract);
builder.optionalChains.guard(node, node, "indexer", contract);
builder.optionalChains.guard(node, node, "method", contract);
builder.closureCaptures.capture(node, []);
builder.closureCaptures.capture(node, captures, receivers, fields);
builder.closureCaptures.capture(node, captures, receivers, fields, { recursiveDeclaration: node });
builder.closureCaptures.capture(node, captures, receivers, fields, { recursiveDeclaration: node, recursiveField }, "shared-state");
builder.preparedOperationResult.get(node);
builder.optionalChain.get(node);
builder.closureCapture.get(node);
builder.closureCaptures.capture(node, [{ declaration: node, reference: node, carrier, storage: "value", fieldName: "captured" }]);
const fieldName: string | undefined = builder.closureCapture.get(node)?.captures[0]?.fieldName;
`);
  assert.equal(positive.status, 0, positive.diagnostics.slice(0, 2048));
  const invalid = [
    ...["preparedOperationResult", "optionalChain", "closureCapture"].map(family =>
      [family, `builder.${family}.set(node, undefined);`, /Property 'set' does not exist/u]),
    ...["rustPreparedOperationResultFactKey", "rustOptionalChainFactKey", "rustClosureCaptureFactKey"].map(key =>
      [key, `import { ${key} } from "${join(root, "dist/analysis/program/records/keys/operation-selections.js")}";`, /Cannot find module.*\/keys\/operation-selections\.js/u]),
    ["prepared foreign subject", "builder.preparedOperations.prepare({}, operation, carrier);", /missing.*properties.*Node/u],
    ["prepared old DTO", "builder.preparedOperations.prepare(node, { operationId: 'id', operationKind: 'method', resultCarrier: carrier });", /Expected 3 arguments/u],
    ["prepared incomplete native template", "builder.preparedOperations.prepare(node, { operationId: 'id', operationKind: 'method' }, carrier);", /missing/u],
    ["prepared invalid operation", "builder.preparedOperations.prepare(node, { ...operation, operationKind: 'guessed' }, carrier);", /not assignable/u],
    ["prepared missing result", "builder.preparedOperations.prepare(node, operation);", /Expected 3 arguments/u],
    ["prepared invalid result", "builder.preparedOperations.prepare(node, operation, {});", /not assignable/u],
    ["guard foreign expression", "builder.optionalChains.guard({}, node, 'property', contract);", /missing.*properties.*Node/u],
    ["guard foreign receiver", "builder.optionalChains.guard(node, {}, 'property', contract);", /missing.*properties.*Node/u],
    ["guard invalid operation", "builder.optionalChains.guard(node, node, 'constructor', contract);", /not assignable/u],
    ["guard old DTO", "builder.optionalChains.guard(node, { expression: node, guard: node, ...contract });", /Expected 4 arguments/u],
    ["guard missing selected input", "builder.optionalChains.guard(node, node, 'property', {});", /missing/u],
    ["guard foreign identity in contract", "builder.optionalChains.guard(node, node, 'property', { ...contract, expression: node });", /does not exist/u],
    ["guard invalid selected carrier", "builder.optionalChains.guard(node, node, 'property', { ...contract, selectedGuardCarrier: {} });", /not assignable/u],
    ["guard invalid source carrier", "builder.optionalChains.guard(node, node, 'property', { ...contract, sourceGuardCarrier: {} });", /not assignable/u],
    ["guard invalid inner carrier", "builder.optionalChains.guard(node, node, 'property', { ...contract, innerResultCarrier: {} });", /not assignable/u],
    ["guard invalid result carrier", "builder.optionalChains.guard(node, node, 'property', { ...contract, resultCarrier: {} });", /not assignable/u],
    ["guard invalid depth", "builder.optionalChains.guard(node, node, 'property', { ...contract, guardDepth: '1' });", /not assignable/u],
    ["guard invalid lowering", "builder.optionalChains.guard(node, node, 'property', { ...contract, lowering: 'unwrap' });", /not assignable/u],
    ["capture foreign subject", "builder.closureCaptures.capture({}, []);", /missing.*properties.*Node/u],
    ["capture old DTO", "builder.closureCaptures.capture(node, { captures: [], receivers: [], receiverFields: [] });", /does not exist/u],
    ["capture missing reference", "builder.closureCaptures.capture(node, [{ declaration: node, carrier, storage: 'value' }]);", /missing/u],
    ["capture invalid storage", "builder.closureCaptures.capture(node, [{ declaration: node, reference: node, carrier, storage: 'shared' }]);", /not assignable/u],
    ["capture invalid mutability", "builder.closureCaptures.capture(node, [{ declaration: node, reference: node, carrier, storage: 'value', mutable: false }]);", /not assignable/u],
    ["capture invalid field name", "builder.closureCaptures.capture(node, [{ declaration: node, reference: node, carrier, storage: 'value', fieldName: 1 }]);", /not assignable/u],
    ["capture foreign source", "builder.closureCaptures.capture(node, [{ declaration: {}, reference: node, carrier, storage: 'value' }]);", /missing.*properties.*Node/u],
    ["capture invalid receiver", "builder.closureCaptures.capture(node, [], [{ owner: node, reference: node, carrier }]);", /missing/u],
    ["capture invalid receiver field", "builder.closureCaptures.capture(node, [], [], [{ declaration: node, receiver: node, reference: node, references: [node], carrier }]);", /missing/u],
    ["capture invalid recursive field", "builder.closureCaptures.capture(node, [], [], [], { recursiveField: {} });", /missing/u],
    ["capture foreign recursive owner", "builder.closureCaptures.capture(node, [], [], [], { recursiveDeclaration: {} });", /missing.*properties.*Node/u],
    ["capture invalid invocation owner", "builder.closureCaptures.capture(node, [], [], [], {}, 'unique');", /not assignable/u],
    ["prepared producer not published", "builder.seal([]).preparedOperations.prepare(node, operation, carrier);", /does not exist/u],
    ["guard producer not published", "builder.seal([]).optionalChains.guard(node, node, 'property', contract);", /does not exist/u],
    ["capture producer not published", "builder.seal([]).closureCaptures.capture(node, []);", /does not exist/u],
  ];
  for (const [name, body, expected] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, expected, name);
  }
  assert.equal(invalid.length, 39);
});
