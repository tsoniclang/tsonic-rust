import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustReceiverOccurrences } from "../../../dist/analysis/ownership/receivers.js";

let sequence = 0;
async function fixture(text, files = {}) {
  const source = createTargetSourceProgram(await checkedSource(`rust-ownership-receivers-${sequence++}`,
    { "src/index.ts": text, ...files }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const selected = analyzeRustReceiverOccurrences(storage);
  assert.equal(selected.kind, "resolved");
  return { source, storage, occurrences: selected.occurrences };
}

test("receiver occurrences follow lexical arrows but not another callable's own receiver", async () => {
  const { source, storage, occurrences } = await fixture(`
    export class Box {
      value = 1;
      field = () => this.value;
      run() {
        this.value;
        const arrow = () => this.value;
        function nested(this: Box) { return this.value; }
        const object = { value: 2, read() { return this.value; } };
        class Inner { value = 3; read() { return this.value; } }
        if (false) { this.value; }
        return [arrow, nested, object, Inner];
      }
    }
  `);
  const declaration = name => storage.nodes.find(node => source.ast.text(source.ast.name(node)) === name &&
    source.ast.body(node) !== undefined);
  const run = declaration("run");
  const nested = declaration("nested");
  const arrows = storage.nodes.filter(node => source.ast.is.IsArrowFunction(node));
  const methods = storage.nodes.filter(node => source.ast.is.IsMethodDeclaration(node) &&
    source.ast.text(source.ast.name(node)) === "read");
  assert.equal(occurrences.get(run)?.length, 3, "own read, lexical arrow, and syntactically present dead branch");
  assert.equal(occurrences.get(nested)?.length, 1, "ordinary function owns its receiver");
  assert.deepEqual(arrows.map(node => occurrences.get(node)?.length), [1, 1], "field and local arrows both have exact bodies");
  assert.deepEqual(methods.map(node => occurrences.get(node)?.length), [1, 1], "object and nested-class methods own their receivers");
  const outer = new Set(occurrences.get(run));
  assert.equal(occurrences.get(arrows[1]).every(node => outer.has(node)), true, "lexical arrow occurrences are shared by identity");
  for (const method of [nested, ...methods]) {
    assert.equal(occurrences.get(method).some(node => outer.has(node)), false, "a distinct receiver does not escape its lexical owner");
  }
});

test("receiver indexing excludes true type syntax, ambient declarations and parameter initializers", async () => {
  const { source, storage, occurrences } = await fixture(`
    declare class External { value: number; read(): this; }
    export class Box {
      value = 1;
      read(argument = this.value): number {
        type Owner = typeof this;
        const value = this as Owner;
        return value.value + argument;
      }
    }
  `, { "types/external.d.ts": "declare class Ambient { read(): this; }" });
  const methods = storage.nodes.filter(node => source.ast.is.IsMethodDeclaration(node));
  const concrete = methods.find(node => source.ast.body(node) !== undefined);
  const indexed = occurrences.get(concrete);
  assert.equal(indexed?.length, 1, "only the body value-expression receiver is retained");
  assert.equal(source.ast.kindName(source.ast.parent(indexed[0])), "KindAsExpression");
  for (const method of methods.filter(node => source.ast.body(node) === undefined)) {
    assert.equal(occurrences.has(method), false, "an ambient/type declaration has no execution body");
  }
});

test("receiver inventories remain finite and fail at their analysis owner", async () => {
  const { storage } = await fixture("class Box { read() { return this; } }");
  const selected = analyzeRustReceiverOccurrences(storage, { maximumSteps: 1 });
  assert.equal(selected.kind, "rejected");
  assert.equal(selected.diagnostics[0].code, "RUST_RECEIVER_OCCURRENCES_UNRESOLVED");
  assert.equal("occurrences" in selected, false, "partial ownership data is never admitted");
  for (const nodes of [[...storage.nodes].reverse(), [...storage.nodes, storage.nodes[0]]]) {
    assert.throws(() => analyzeRustReceiverOccurrences({ ...storage, nodes }),
      /unique checked nodes after their exact source parents/u);
  }
});
