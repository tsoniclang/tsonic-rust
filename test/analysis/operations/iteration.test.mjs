import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { ForInOrOfStatement_Initializer } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const surfaces of [[], ["js"]]) for (const fresh of [false, true]) {
  const profile = surfaces[0] ?? "native";
  test(`checked ${fresh ? "fresh" : "retained"} iteration preserves source/binding admission in ${profile}`, () => {
    const { source, program } = analyzeRust({ surfaces, files: { "index.ts": fresh
      ? "export function total(): number { let sum = 0; for (const value of [1, 2, 3]) sum += value; return sum; }"
      : `import type { int32 } from "@tsonic/core/types.js";
        export function total(values: readonly int32[]): int32 { let sum: int32 = 0; for (const value of values) sum += value; return sum; }`,
    } });
    const nodes = [];
    const pending = [...program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)];
    while (pending.length > 0) {
      const node = pending.pop();
      nodes.push(node);
      source.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    const statements = nodes.filter(node => source.ast.kindName(node) === "KindForOfStatement");
    assert.equal(statements.length, 1);
    const operation = program.records.targetOperation.get(statements[0]);
    assert.equal(operation?.kind, "iteration");
    const initializer = ForInOrOfStatement_Initializer(source.ast, statements[0]);
    const binding = nodes.find(node => source.ast.is.IsVariableDeclaration(node) && source.ast.text(source.ast.name(node)) === "value");
    assert.equal(initializer !== undefined && binding !== undefined, true, "the exact initializer and authored binding are retained");
    assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(initializer)?.carrier, operation.elementCarrier), true);
    assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(binding)?.carrier, operation.elementCarrier), true);
    if (profile === "native") {
      assert.equal(operation.lowering.kind, fresh ? "owned" : "borrowed");
      if (!fresh) assert.equal(operation.lowering.style, "copied");
    }
  });
}
