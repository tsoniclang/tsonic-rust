import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { planRustSelectedErrorRegion } from "../../../dist/backend/planner/program/error-regions.js";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "../../../dist/target-model/types/carriers/producer-errors.js";

function fixture() {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export async function pure(): Promise<string> { return "value"; }
export async function failed(): Promise<string> { throw "failure"; }
export function invoke(callback: () => string): string { return callback(); }
` } });
  const ast = program.source.ast;
  const file = program.records.sourceArtifacts.get().find(artifact => ast.getFileName(artifact.sourceFile) === "/src/index.ts").sourceFile;
  const declaration = name => ast.statements(file).find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
  return { program, declaration };
}

test("completed error regions publish physical payloads before native rendering", () => {
  const { program, declaration } = fixture();
  const records = program.records.nativeErrorRegion;
  assert.equal(records.get(declaration("pure")).kind, "infallible");
  const failed = records.get(declaration("failed"));
  assert.equal(failed.kind, "package");
  assert.equal(failed.localOwner.kind, "physical");
  assert.equal(records.get({}), undefined, "source identity is not reconstructed from shape");
  assert.equal(Object.isFrozen(records) && Object.isFrozen(failed) && Object.isFrozen(failed.sources), true);
  assert.equal(Object.hasOwn(program, "errorRegions"), false, "no semantic catalog remains on the sealed program");
  assert.equal(Object.hasOwn(program, "callableValues"), false, "producer analysis is not exposed to rendering");
});

test("native error rendering consumes the sealed template without source or callable analysis", () => {
  const { program, declaration } = fixture();
  const selected = program.records.nativeErrorRegion.get(declaration("invoke"));
  assert.equal(selected.sources.length > 0, true, "the invocation has its exact native error sources");
  const neverRead = new Proxy({}, { get() { throw new Error("post-publication semantic access"); } });
  const rendered = [];
  const result = planRustSelectedErrorRegion(selected, {
    input: { program: { records: program.records, source: { ast: neverRead } } },
    moduleNameByFileName: new Map([[selected.fileName, "index"]]),
    externalCrateNameByFileName: new Map(),
  }, carrier => { rendered.push(carrier); return { kind: "named", path: "ExactError" }; });
  assert.equal(result !== undefined && result.boundary !== undefined, true, "the selected native region renders");
  assert.equal(rendered.length, selected.sources.length);
  assert.equal(rendered.every((carrier, index) => carrier === selected.sources[index].errorType), true,
    "rendering receives the exact pre-seal source carriers without reclassification");
});

test("producer-error native vocabulary rejects malformed data without executing accessors", () => {
  const reference = { identity: "producer", fileName: "/src/index.ts", channel: "invoke", genericArguments: [] };
  assert.deepEqual(rustProducerErrorReference(rustProducerErrorTargetType(reference)), reference);
  for (const change of [{ channel: -1 }, { channel: Infinity }, { genericArguments: undefined },
    { genericArguments: [{ kind: "not-an-argument" }] }]) {
    assert.equal(rustProducerErrorReference({ kind: "target-specific", target: "rust", name: "producer-error",
      value: { ...reference, ...change } }), undefined);
  }
  let reads = 0;
  const accessor = Object.defineProperty({ ...reference }, "identity", { enumerable: true,
    get() { reads++; return reference.identity; } });
  assert.equal(rustProducerErrorReference({ kind: "target-specific", target: "rust", name: "producer-error", value: accessor }), undefined);
  assert.equal(reads, 0);
});
