import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = join(root, ".temp/async-member-producers-types");
const prelude = `
import { createRustProgramRecordBuilder } from "${join(root, "dist/analysis/program/records/create.js")}";
import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "${join(root, "dist/target-model/types/model.js")}";
import type { RustAsyncFunctionFact, RustGeneratorFact } from "${join(root, "dist/target-model/records/callables/callables-and-resources.js")}";
import type { RustTargetOperationFact } from "${join(root, "dist/target-model/records/operations/operations.js")}";
import type { RustComputedMemberFact } from "${join(root, "dist/target-model/records/operations/operation-selections.js")}";
declare const ast: AstReader;
declare const node: Node;
declare const carrier: TargetTypeRef;
declare const generator: RustGeneratorFact;
declare const selected: Extract<RustAsyncFunctionFact, { kind: "js-promise" }>;
declare const abi: Extract<RustTargetOperationFact, { kind: "runtime-set" }>["abi"];
const builder = createRustProgramRecordBuilder();
`;

function check(directory, body) {
  writeFileSync(join(directory, "case.ts"), prelude + body);
  const result = spawnSync(resolve(root, "../tsonic/node_modules/.bin/tsgo"),
    ["-p", join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
  assert.equal(result.error === undefined, true, "bounded strict proof finishes without signal or truncation");
  return { status: result.status, diagnostics: result.stdout + result.stderr };
}

test("four producer APIs require exact source/domain inputs and reject every removed generic writer and key", () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(join(temporary, "case-"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { noEmit: true, rootDir: root, noUnusedLocals: false, noUnusedParameters: false },
    include: [], exclude: [], files: [join(directory, "case.ts")],
  }));
  const positive = check(directory, `
builder.asyncFunctions.native(node, carrier);
builder.asyncFunctions.promise(node, carrier, carrier, selected.lowering);
builder.yields.value(node, node, generator);
builder.yields.delegate(node, node, generator, carrier, carrier);
const computed: RustComputedMemberFact = builder.computedMembers.evaluate(ast, node, node, node, "read");
builder.computedMembers.evaluate(ast, node, node, node, "read-write", false);
builder.computedMembers.evaluate(ast, node, node, node, "write", true);
builder.computedMembers.evaluate(ast, node, node, node, "delete");
builder.compoundWrites.index(node, "native.index-set", abi);
builder.asyncFunction.get(node);
builder.yield.get(node);
builder.computedMember.get(node);
builder.compoundWrite.get(node);
`);
  assert.equal(positive.status, 0, positive.diagnostics);
  const removedKeys = [
    ["rustAsyncFunctionFactKey", "callables-and-resources", /Cannot find module/u], ["rustYieldFactKey", "callables-and-resources", /Cannot find module/u],
    ["rustComputedMemberFactKey", "operation-selections", /Cannot find module.*\/keys\/operation-selections\.js/u], ["rustCompoundWriteFactKey", "operation-selections", /Cannot find module.*\/keys\/operation-selections\.js/u],
  ];
  const invalid = [
    ...["asyncFunction", "yield", "computedMember", "compoundWrite"].map(family =>
      [family, `builder.${family}.set(node, undefined);`, /Property 'set' does not exist/u]),
    ...removedKeys.map(([key, module, diagnostic]) => [key,
      `import { ${key} } from "${join(root, `dist/analysis/program/records/keys/${module}.js`)}";`, diagnostic]),
    ["computed pure helper", `import { recordRustComputedMemberEvaluation } from "${join(root,
      "dist/analysis/operations/computed-members.js")}";`, /has no exported member/u],
    ["native foreign declaration", "builder.asyncFunctions.native({}, carrier);", /missing.*properties.*Node/u],
    ["native malformed output", "builder.asyncFunctions.native(node, { kind: 'invalid' });", /not assignable/u],
    ["promise foreign declaration", "builder.asyncFunctions.promise({}, carrier, carrier, selected);", /missing.*properties.*Node/u],
    ["promise missing storage", "builder.asyncFunctions.promise(node, carrier, carrier, {});", /missing.*properties/u],
    ["promise foreign captured node", "builder.asyncFunctions.promise(node, carrier, carrier, { ...selected, capturedParameters: [{}] });", /missing.*properties.*Node/u],
    ["promise malformed region", "builder.asyncFunctions.promise(node, carrier, carrier, { ...selected, storage: { kind: 'lifetime' } });", /Property 'lifetime' is missing/u],
    ["promise malformed receiver", "builder.asyncFunctions.promise(node, carrier, carrier, { ...selected, ownedReceiver: { carrier } });", /Property 'occurrences' is missing/u],
    ["yield foreign expression", "builder.yields.value({}, node, generator);", /missing.*properties.*Node/u],
    ["yield foreign generator", "builder.yields.value(node, {}, generator);", /missing.*properties.*Node/u],
    ["yield missing protocol", "builder.yields.value(node, node, {});", /missing.*properties/u],
    ["yield invalid delegated carrier", "builder.yields.delegate(node, node, generator, { kind: 'invalid' }, carrier);", /not assignable/u],
    ["yield missing delegated result", "builder.yields.delegate(node, node, generator, carrier);", /Expected 5 arguments/u],
    ["computed missing AST", "builder.computedMembers.evaluate({}, node, node, node, 'read');", /missing.*properties.*AstReader/u],
    ["computed foreign subject", "builder.computedMembers.evaluate(ast, {}, node, node, 'read');", /missing.*properties.*Node/u],
    ["computed foreign receiver", "builder.computedMembers.evaluate(ast, node, {}, node, 'read');", /missing.*properties.*Node/u],
    ["computed foreign key", "builder.computedMembers.evaluate(ast, node, node, {}, 'read');", /missing.*properties.*Node/u],
    ["computed invalid mode", "builder.computedMembers.evaluate(ast, node, node, node, 'update');", /not assignable/u],
    ["computed invalid evaluation", "builder.computedMembers.evaluate(ast, node, node, node, 'read', 1);", /not assignable/u],
    ["compound foreign subject", "builder.compoundWrites.index({}, 'native.index-set', abi);", /missing.*properties.*Node/u],
    ["compound malformed ID", "builder.compoundWrites.index(node, 1, abi);", /not assignable/u],
    ["compound missing ABI", "builder.compoundWrites.index(node, 'native.index-set', {});", /missing.*properties/u],
  ];
  for (const [name, body, diagnostic] of invalid) {
    const result = check(directory, body);
    assert.notEqual(result.status, 0, name);
    assert.match(result.diagnostics, diagnostic, name);
  }
  assert.equal(invalid.length, 30);
});
