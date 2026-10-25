import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { borrowedNullishSequencesSource } from "../../../../tsonic/test/fixtures/borrowed-nullish-sequences.mjs";
import { createTsonicPlugin } from "../../../../rust-nodejs/dist/index.js";
import { analyzeRustBorrowedInitializers } from "../../../dist/analysis/storage/borrowed-initializers.js";
import { createRustBorrowedInitializerProducer } from "../../../dist/analysis/program/records/borrowed-initializers.js";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const surfaces of [[], ["js"]]) {
  test(`native method elision retains the exact initializer receiver (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, capabilities: [createTsonicPlugin()],
      files: { "index.ts": borrowedNullishSequencesSource } });
    const { ast } = program.source;
    const initializers = [];
    const nativeNodes = [];
    const visit = node => {
      nativeNodes.push(node);
      if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "values")
        initializers.push(ast.as.AsVariableDeclaration(node).Initializer);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(initializers.length, 3);
    for (const initializer of initializers) {
      const selection = program.records.borrowedInitializer.get(initializer);
      assert.equal(selection !== undefined, true, "each actual native view has its checked receiver lifetime owner");
      assert.equal(selection.receiver === ast.as.AsElementAccessExpression(initializer).Expression, true,
        "the exact receiver survives nested fields without name matching");
      const operation = program.records.targetOperation.get(initializer);
      assert.equal(operation?.kind, "provider-operation");
      assert.equal(operation.abi.targetReceiver.kind, "input");
      assert.equal(rustTargetTypeRefEquals(selection.carrier, operation.abi.targetReceiver.input.sourceCarrier), true,
        "the exact finalized native receiver carrier is retained without replacing its metadata representation");
      assert.equal(Object.isFrozen(selection), true);
    }
    assert.equal(Object.isFrozen(program.records.borrowedInitializer), true);
    const initializer = initializers[0];
    const fact = program.records.targetOperation.get(initializer);
    const input = fact.abi.targetReceiver.input;
    const invalid = [
      { ...fact, abi: { ...fact.abi, targetReceiver: { kind: "none" } } },
      { ...fact, abi: { ...fact.abi, target: { form: "call", path: "foreign" } } },
      { ...fact, abi: { ...fact.abi, targetReceiver: { kind: "input", input: { ...input, mode: "by-value" } } } },
      { ...fact, abi: { ...fact.abi, result: { ...fact.abi.result, carrier: { kind: "source-primitive", name: "string" } } } },
      { ...fact, abi: { ...fact.abi, result: { ...fact.abi.result,
        rawCarrier: { kind: "reference", mutable: false, referent: { kind: "source-primitive", name: "string" }, lifetime: { kind: "static" } } } } },
    ];
    for (const mutation of [undefined, ...invalid]) {
      const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === initializer ? mutation : program.records.targetOperation.get(node);
} }}, program.records);
      const selected = createRustBorrowedInitializerProducer(() => {});
      analyzeRustBorrowedInitializers(ast, nativeNodes, records,
        program.ownership.reads, selected);
      assert.equal(selected.records.get(initializer) === undefined, true, "missing or incompatible borrowing evidence is never manufactured");
    }
  });
}
